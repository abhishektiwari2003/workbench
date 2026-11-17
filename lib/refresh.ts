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
import { getContext, getResult } from "./store";
import type { Job } from "./types";
import { addNewMatches, allUsers, votesOf } from "./users";

const PER_USER_MAX = 10; // new jobs re-scored per user per refresh
const PER_USER_MS = 30_000; // each user's re-score gets its own deadline: one slow user can't sink the rest
const BUDGET_MS = 90_000; // stop starting new users before the route's 120s limit; the report says how many waited

export type RefreshReport = {
  total: number;
  added: number;
  closed: number;
  simulated: number;
  usersChecked: number;
  usersFailed: number;
  usersSkipped: number;
  jobsRescored: number;
  newMatches: number;
  costUsd: number;
  fetchedAt: string;
};

/** Jobs this user has already been shown in their latest result: never reported to them as "new". */
function seenBy(userId: string, latestRunId: string | undefined): Set<string> {
  const result = latestRunId ? getResult(latestRunId, userId) : undefined;
  return new Set(result?.matches.map((m) => m.job.id) ?? []);
}

/**
 * Dev/demo only: treat `n` real jobs as if they had just been posted, so the re-score path runs live on
 * jobs that plausibly fit someone. Taken from stored users' shortlists but never from what they were already
 * shown (best fast-model scores first). Reported as "simulated", never as real.
 */
function pickSimulated(n: number): Job[] {
  const pool = new Map<string, { job: Job; score: number }>();
  for (const { userId, latestRunId } of allUsers()) {
    const ctx = latestRunId ? getContext(latestRunId, userId) : undefined;
    const seen = seenBy(userId, latestRunId);
    for (const r of ctx?.ranked ?? []) {
      if (!seen.has(r.job.id)) pool.set(r.job.id, { job: r.job, score: ctx?.fast.get(r.job.id)?.score ?? 0 });
    }
  }
  return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, n).map((p) => p.job);
}

export async function runRefresh({ simulate = 0 }: { simulate?: number } = {}): Promise<RefreshReport> {
  const { after, added: realAdded, closed } = await refreshJobs();
  const simulated = simulate > 0 ? pickSimulated(simulate) : [];
  const added = [...new Map([...realAdded, ...simulated].map((j) => [j.id, j])).values()];

  let usersChecked = 0;
  let usersFailed = 0;
  let usersSkipped = 0;
  let jobsRescored = 0;
  let newMatches = 0;
  const meter = new CostMeter();
  const started = Date.now();
  for (const { userId, latestRunId } of allUsers()) {
    const ctx = latestRunId ? getContext(latestRunId, userId) : undefined;
    if (!ctx || added.length === 0) continue;
    if (Date.now() - started > BUDGET_MS) {
      usersSkipped += 1; // picked up by the next scheduled refresh
      continue;
    }
    usersChecked += 1;
    // A new job gets a paid look only if it would have made this user's shortlist (free prefilter check)
    // and the user hasn't already been shown it.
    const seen = seenBy(userId, latestRunId);
    const bar = ctx.ranked.at(-1)?.prefilter ?? 0;
    const ranked = rankAll(ctx.profile, added.filter((j) => !seen.has(j.id)), nudgeFrom(votesOf(userId)))
      .filter((r) => r.prefilter >= bar)
      .slice(0, PER_USER_MAX);
    if (ranked.length === 0) continue;
    jobsRescored += ranked.length;
    try {
      const opts = { profile: ctx.profile, meter, signal: AbortSignal.timeout(PER_USER_MS) };
      const { scores } = await fastScore(ranked, opts, () => {});
      const worth = ranked.filter((r) => (scores.get(r.job.id)?.score ?? 0) >= GOOD_SCORE);
      const explained = worth.length ? await explain(worth, opts, () => {}) : new Map();
      const found = assignTiers(worth.map((r) => toScoredJob(r, scores.get(r.job.id), explained.get(r.job.id)))).filter((m) => m.tier !== "closest");
      addNewMatches(userId, found);
      newMatches += found.length;
    } catch (err) {
      usersFailed += 1; // one user's LLM failure never stops the refresh for everyone else
      console.warn(JSON.stringify({ evt: "refresh_user_failed", error: err instanceof Error ? err.message : String(err) }));
    }
  }
  return {
    total: after.jobs.length,
    added: added.length,
    closed: closed.length,
    simulated: simulated.length,
    usersChecked,
    usersFailed,
    usersSkipped,
    jobsRescored,
    newMatches,
    costUsd: roundUsd(meter.total().computeUsd),
    fetchedAt: new Date(after.fetchedAt).toISOString(),
  };
}
