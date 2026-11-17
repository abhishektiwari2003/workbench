// In-memory store of match results (what the user sees) and their run context (what the copilot,
// quality panel and refresh need; never sent to the browser). Bounded and expiring.
// Production: Redis or Postgres with the same interface.
import type { Ranked } from "./prefilter";
import type { FastScore, Profile } from "./schemas";
import type { MatchResult } from "./types";
import { singleton } from "./singleton";

export type RunContext = {
  resumeText: string;
  profile: Profile;
  ranked: Ranked[]; // the shortlist, in prefilter order
  fast: Map<string, FastScore>; // fast-model scores for the shortlist
  snapshotAt: number; // job snapshot the run used
};

type Entry = { result: MatchResult; context: RunContext; ownerId: string; expires: number };

const MAX_RESULTS = 1_000;
const TTL_MS = 7 * 24 * 60 * 60_000;
const results = singleton("results", () => new Map<string, Entry>()); // oldest-first eviction

export function saveResult(result: MatchResult, context: RunContext, ownerId: string): void {
  if (results.size >= MAX_RESULTS) results.delete(results.keys().next().value as string);
  results.set(result.id, { result, context, ownerId, expires: Date.now() + TTL_MS });
}

function entry(id: string): Entry | undefined {
  const hit = results.get(id);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    results.delete(id);
    return undefined;
  }
  return hit;
}

/** Owner-only: every result has an owner, and holding the id is never enough to read it. */
export function getResult(id: string, userId: string): MatchResult | undefined {
  const e = entry(id);
  return e && e.ownerId === userId ? e.result : undefined;
}

export function getContext(id: string, userId: string): RunContext | undefined {
  const e = entry(id);
  return e && e.ownerId === userId ? e.context : undefined;
}
