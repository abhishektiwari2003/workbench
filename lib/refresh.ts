// Scheduled refresh: re-fetch the boards, diff new and closed jobs, and re-score ONLY the new jobs for
// stored users. Cost scales with (new jobs x users they plausibly fit), not with the whole catalogue.
//
// Production schedule: Vercel Cron, e.g. vercel.json {"crons":[{"path":"/api/refresh","schedule":"*/30 * * * *"}]},
// or EventBridge -> SQS -> worker. The scheduler sends CRON_SECRET as a Bearer token. At scale each user's
// re-score becomes its own queued job, batched through the Message Batches API (50% cheaper, not latency-bound).
import { refreshJobs } from "./boards";
import { CostMeter } from "./cost";
import { nudgeFrom } from "./feedback";
import { explain, fastScore } from "./pipeline/score";
import { assignTiers, toScoredJob } from "./pipeline/tiers";
import { rankAll } from "./prefilter";
import { roundUsd } from "./pricing";
import { GOOD_SCORE } from "./schemas";
import { getContext } from "./store";
import type { Job } from "./types";
import { addNewMatches, allUsers, votesOf } from "./users";

const PER_USER_MAX = 10; // new jobs re-scored per user per refresh
const DEADLINE_MS = 60_000;

export type RefreshReport = {
  total: number;
  added: number;
  closed: number;
  simulated: number;
  usersChecked: number;
  jobsRescored: number;
  newMatches: number;
  costUsd: number;
  fetchedAt: string;
};

/**
 * Dev/demo only: treat `n` real jobs from stored users' shortlists as if they had just been posted, so the
 * re-score path runs live on jobs that plausibly fit someone. Reported as "simulated", never as real.
 */
function pickSimulated(n: number): Job[] {
  const pool = new Map<string, Job>();
  for (const { userId, latestRunId } of allUsers()) {
    const ctx = latestRunId ? getContext(latestRunId, userId) : undefined;
    for (const r of ctx?.ranked.slice(0, 15) ?? []) pool.set(r.job.id, r.job);
  }
  return [...pool.values()].sort(() => Math.random() - 0.5).slice(0, n);
}

export async function runRefresh({ simulate = 0 }: { simulate?: number } = {}): Promise<RefreshReport> {
  const { after, added: realAdded, closed } = await refreshJobs();
  const simulated = simulate > 0 ? pickSimulated(simulate) : [];
  const added = [...new Map([...realAdded, ...simulated].map((j) => [j.id, j])).values()];

  let usersChecked = 0;
  let jobsRescored = 0;
  let newMatches = 0;
  const meter = new CostMeter();
  const signal = AbortSignal.timeout(DEADLINE_MS);
  for (const { userId, latestRunId } of allUsers()) {
    const ctx = latestRunId ? getContext(latestRunId, userId) : undefined;
    if (!ctx || added.length === 0) continue;
    usersChecked += 1;
    // A new job gets a paid look only if it would have made this user's shortlist (free prefilter check).
    const bar = ctx.ranked.at(-1)?.prefilter ?? 0;
    const ranked = rankAll(ctx.profile, added, nudgeFrom(votesOf(userId)))
      .filter((r) => r.prefilter >= bar)
      .slice(0, PER_USER_MAX);
    if (ranked.length === 0) continue;
    jobsRescored += ranked.length;
    const opts = { profile: ctx.profile, meter, signal };
    const { scores } = await fastScore(ranked, opts, () => {});
    const worth = ranked.filter((r) => (scores.get(r.job.id)?.score ?? 0) >= GOOD_SCORE);
    const explained = worth.length ? await explain(worth, opts, () => {}) : new Map();
    const found = assignTiers(worth.map((r) => toScoredJob(r, scores.get(r.job.id), explained.get(r.job.id)))).filter((m) => m.tier !== "closest");
    addNewMatches(userId, found);
    newMatches += found.length;
  }
  return {
    total: after.jobs.length,
    added: added.length,
    closed: closed.length,
    simulated: simulated.length,
    usersChecked,
    jobsRescored,
    newMatches,
    costUsd: roundUsd(meter.total().computeUsd),
    fetchedAt: new Date(after.fetchedAt).toISOString(),
  };
}
