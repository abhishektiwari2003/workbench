// Per-user state, in memory and keyed by Clerk userId: run history, visits, votes, daily quota.
// Production: a `users` + `runs` + `votes` table in Postgres (see docs/SCALE.md section 7).
import type { MatchResult, ScoredJob } from "./types";
import { singleton } from "./singleton";

export const DAILY_RUNS = 5; // fresh (paid) searches per user per day; cache hits are free
const MAX_HISTORY = 20;
const NEW_VISIT_AFTER_MS = 30 * 60_000; // a gap this long starts a new "visit"

export type RunSummary = {
  id: string;
  createdAt: string;
  strong: number;
  good: number;
  top: { title: string; company: string; score: number }[];
  computeUsd: number;
  spentUsd: number;
  cached: boolean;
};
export type Vote = { vote: 1 | -1; company: string; title: string };

type UserState = {
  runs: RunSummary[];
  lastSeenAt: number | null;
  previousVisitAt: number | null; // start of the visit before this one
  votes: Map<string, Vote>;
  quota: { day: string; used: number };
  newMatches: ScoredJob[]; // found by scheduled refreshes since the user's last search
};

const users = singleton("users", () => new Map<string, UserState>());
const today = () => new Date().toISOString().slice(0, 10);

function state(userId: string): UserState {
  let s = users.get(userId);
  if (!s) {
    s = { runs: [], lastSeenAt: null, previousVisitAt: null, votes: new Map(), quota: { day: today(), used: 0 }, newMatches: [] };
    users.set(userId, s);
  }
  if (s.quota.day !== today()) s.quota = { day: today(), used: 0 };
  s.newMatches ??= []; // records created by an older build of this module (dev reloads keep state)
  return s;
}

export function quotaOf(userId: string) {
  const { used } = state(userId).quota;
  return { used, limit: DAILY_RUNS, remaining: Math.max(0, DAILY_RUNS - used) };
}

/** Takes one of today's searches before the run starts, so concurrent requests can't all pass the check. */
export function reserveRun(userId: string): boolean {
  const q = state(userId).quota;
  if (q.used >= DAILY_RUNS) return false;
  q.used += 1;
  return true;
}

/** Gives a reserved search back: the run failed, or it turned out to be free (cache hit or joined a run). */
export function refundRun(userId: string) {
  const q = state(userId).quota;
  q.used = Math.max(0, q.used - 1);
}

/** Adds a run to history. Quota is settled separately (reserveRun/refundRun); the same id is recorded once. */
export function recordRun(userId: string, r: MatchResult) {
  const s = state(userId);
  s.newMatches = s.newMatches.filter((m) => !r.matches.some((x) => x.job.id === m.job.id)); // now part of a full result
  if (s.runs.some((x) => x.id === r.id)) return; // a second tab joined this user's own in-flight run
  s.runs.unshift({
    id: r.id,
    createdAt: r.createdAt,
    strong: r.matches.filter((m) => m.tier === "strong").length,
    good: r.matches.filter((m) => m.tier === "good").length,
    top: r.matches.slice(0, 3).map((m) => ({ title: m.job.title, company: m.job.company, score: m.score })),
    computeUsd: r.cost.computeUsd,
    spentUsd: r.cost.spentUsd,
    cached: r.servedFromCache,
  });
  s.runs.length = Math.min(s.runs.length, MAX_HISTORY);
}

export function history(userId: string): RunSummary[] {
  return state(userId).runs;
}

/** Marks activity; returns when the previous visit started (null on a first visit). Stable within a visit. */
export function touchVisit(userId: string): number | null {
  const s = state(userId);
  const now = Date.now();
  if (s.lastSeenAt === null || now - s.lastSeenAt > NEW_VISIT_AFTER_MS) s.previousVisitAt = s.lastSeenAt;
  s.lastSeenAt = now;
  return s.previousVisitAt;
}

export function setVote(userId: string, jobId: string, vote: 1 | -1 | 0, job: { company: string; title: string }) {
  const s = state(userId);
  if (vote === 0) s.votes.delete(jobId);
  else s.votes.set(jobId, { vote, ...job });
}

export function votesOf(userId: string): Map<string, Vote> {
  return state(userId).votes;
}

/** All users with a stored run, for the scheduled refresh. */
export function allUsers(): { userId: string; latestRunId: string | undefined }[] {
  return [...users.entries()].map(([userId, s]) => ({ userId, latestRunId: s.runs.find((r) => !r.cached)?.id ?? s.runs[0]?.id }));
}

const MAX_NEW = 20;

export function addNewMatches(userId: string, matches: ScoredJob[]) {
  const s = state(userId);
  const seen = new Set(s.newMatches.map((m) => m.job.id));
  s.newMatches = [...matches.filter((m) => !seen.has(m.job.id)), ...s.newMatches].slice(0, MAX_NEW);
}

export function newMatchesOf(userId: string): ScoredJob[] {
  return state(userId).newMatches;
}
