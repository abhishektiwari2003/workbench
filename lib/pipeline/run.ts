// The match pipeline:
//   boards (shared snapshot) -> scanned -> prefilter (free) -> fast model scores -> smart model explains -> tiers
// Emits progress events for the live funnel; identical concurrent runs share one computation;
// repeat runs are served from the result cache with the original compute cost.
import { randomUUID } from "node:crypto";
import { getJobs, peekJobs } from "../boards";
import { CostMeter } from "../cost";
import { digestInBackground, warmDigests } from "../digests";
import { recordCache, recordCandidate } from "../metrics";
import { shortlist } from "../prefilter";
import { getCached, resultKey, setCached } from "../result-cache";
import { SHORTLIST_SIZE, type Explained } from "../schemas";
import { saveResult, type RunContext } from "../store";
import type { Job, MatchResult, PipelineEvent } from "../types";
import { buildProfile } from "./profile";
import { explain, fastScore } from "./score";
import { assignTiers, pickForExplain, toScoredJob } from "./tiers";

const DEADLINE_MS = 45_000; // whole pipeline; beyond this we return a clean 504 instead of hanging

/** Fan-out of one run's events to every caller sharing it, replaying what a late joiner missed. */
class RunChannel {
  readonly events: PipelineEvent[] = [];
  private listeners = new Set<(e: PipelineEvent) => void>();
  emit = (e: PipelineEvent) => {
    this.events.push(e);
    for (const l of this.listeners) l(e);
  };
  subscribe(l: (e: PipelineEvent) => void) {
    this.events.forEach(l);
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export type RunOptions = {
  emit?: (e: PipelineEvent) => void;
  prefsKey?: string; // changes when the user's feedback changes, so cached rankings don't go stale
  nudge?: (job: Job) => number; // per-user ranking nudge from thumbs up/down
  feedbackCount?: number; // how many ratings shaped this ranking (shown to the user)
  ownerId: string; // required: results are owner-only, never readable by id alone
};

/** Would this resume cost nothing right now (cached, or joining an identical run in flight)? Free runs skip the quota. */
export function isFreeRun(resumeText: string, prefsKey = ""): boolean {
  const key = resultKey(resumeText, prefsKey);
  return inflight.has(key) || Boolean(getCached(key, peekJobs()?.fetchedAt));
}

async function compute(resumeText: string, channel: RunChannel, opts: RunOptions) {
  const started = Date.now();
  const meter = new CostMeter((c) => channel.emit({ type: "cost", ...c }));
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const emitStage = (stage: "scanned" | "prefiltered" | "scored" | "explained", count: number, done: boolean) =>
    channel.emit({ type: "stage", stage, count, done });

  // Board fetch and profile extraction are independent: run them together.
  const [profile, snapshot] = await Promise.all([
    buildProfile(resumeText, meter, signal),
    getJobs({ onBoard: (board) => channel.emit({ type: "board", board }) }),
  ]);
  emitStage("scanned", snapshot.jobs.length, true);

  const ranked = shortlist(profile, snapshot.jobs, SHORTLIST_SIZE, opts.nudge);
  emitStage("prefiltered", ranked.length, true);

  // Shared job digests: use the ones already cached; digest the rest in the background (platform cost,
  // no added latency) so every later candidate with an overlapping shortlist gets them free.
  const jobs = ranked.map((r) => r.job);
  const warm = warmDigests(jobs);
  const scheduled = digestInBackground(jobs);
  channel.emit({ type: "digest", cached: warm.size, computed: scheduled });

  let scoredCount = 0;
  const { scores: fast } = ranked.length
    ? await fastScore(ranked, { profile, meter, signal, digests: warm }, (n) => emitStage("scored", (scoredCount += n), false))
    : { scores: new Map() };
  emitStage("scored", fast.size, true);

  const toExplain = pickForExplain(ranked, fast);
  let explainedCount = 0;
  // Explanations are the last, priciest stage: if every Sonnet batch fails, keep Haiku's scores rather than
  // failing a search that has already been paid for. The UI says the explanations are missing.
  const explained: Map<string, Explained> = toExplain.length
    ? await explain(toExplain, { profile, meter, signal, digests: warm }, (n) => emitStage("explained", (explainedCount += n), false)).catch(
        (err: unknown) => {
          console.warn(JSON.stringify({ evt: "explain_failed", error: err instanceof Error ? err.message : String(err) }));
          return new Map<string, Explained>();
        },
      )
    : new Map();
  emitStage("explained", explained.size, true);

  const scored = toExplain.map((r) => toScoredJob(r, fast.get(r.job.id), explained.get(r.job.id)));
  const byJob = new Map(snapshot.jobs.map((j) => [j.id, j]));
  const tieBreak = (id: string) => (opts.nudge && byJob.has(id) ? opts.nudge(byJob.get(id)!) * 20 : 0);
  const result: MatchResult = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    servedFromCache: false,
    profile: {
      headline: profile.headline,
      seniority: profile.seniority,
      yearsExperience: profile.yearsExperience,
      country: profile.country,
      targetTitles: profile.targetTitles,
      skills: profile.skills.slice(0, 12),
      openToRemote: profile.openToRemote,
    },
    stats: { jobsScanned: snapshot.jobs.length, boards: snapshot.boards, unscored: ranked.length - fast.size, unexplained: toExplain.length - explained.size, ms: Date.now() - started },
    funnel: { scanned: snapshot.jobs.length, prefiltered: ranked.length, scored: fast.size, explained: explained.size },
    digests: { cached: warm.size, computed: scheduled },
    matches: assignTiers(scored, tieBreak),
    cost: meter.total(),
    feedbackCount: opts.feedbackCount ?? 0,
  };
  const context: RunContext = { resumeText, profile, ranked, fast, snapshotAt: snapshot.fetchedAt };
  return { result, context };
}

type Inflight = { channel: RunChannel; promise: Promise<{ result: MatchResult; context: RunContext }>; ownerId: string };
const inflight = new Map<string, Inflight>();

/** `created` is true only for the caller that started (and paid for) a fresh run: the one to charge quota. */
export async function runMatch(resumeText: string, opts: RunOptions): Promise<{ result: MatchResult; created: boolean }> {
  const key = resultKey(resumeText, opts.prefsKey ?? "");
  const { ownerId } = opts;

  const hit = getCached(key, peekJobs()?.fetchedAt);
  recordCache("result", Boolean(hit));
  if (hit) {
    // Same resume, same jobs: replay the original progress and return the stored result at $0.
    opts.emit?.({ type: "cached", computedAt: hit.result.createdAt });
    hit.events.filter((e) => e.type !== "result").forEach((e) => opts.emit?.(e));
    const result: MatchResult = {
      ...hit.result,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      servedFromCache: true,
      cost: { ...hit.result.cost, spentUsd: 0 },
    };
    saveResult(result, hit.context, ownerId);
    recordCandidate(result);
    opts.emit?.({ type: "result", result });
    return { result, created: false };
  }

  // Single-flight: identical resumes submitted concurrently (double click, two tabs) share one run.
  let run = inflight.get(key);
  const created = !run;
  if (!run) {
    const channel = new RunChannel();
    const promise = compute(resumeText, channel, opts)
      .then(({ result, context }) => {
        // A partial result is not cached, so "run the search again" really does retry the missing jobs.
        if (!result.stats.unscored && !result.stats.unexplained) {
          setCached(key, { result, events: [...channel.events], context, snapshotAt: context.snapshotAt });
        }
        saveResult(result, context, ownerId);
        recordCandidate(result);
        channel.emit({ type: "result", result });
        return { result, context };
      })
      .finally(() => inflight.delete(key));
    run = { channel, promise, ownerId };
    inflight.set(key, run);
  }
  const joined = run.ownerId !== ownerId; // another user's identical run: share the work, not the result id
  const unsubscribe = opts.emit ? run.channel.subscribe(joined ? (e) => e.type !== "result" && opts.emit!(e) : opts.emit) : undefined;
  try {
    const { result, context } = await run.promise;
    if (!joined) return { result, created };
    const own: MatchResult = { ...result, id: randomUUID(), cost: { ...result.cost, spentUsd: 0 }, servedFromCache: true };
    saveResult(own, context, ownerId);
    opts.emit?.({ type: "result", result: own });
    return { result: own, created: false };
  } finally {
    unsubscribe?.();
  }
}
