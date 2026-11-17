// In-memory store of match results so a candidate can come back to their link.
// Bounded (oldest-first eviction) and expiring. Production: Redis or Postgres with the same interface.
import type { MatchResult } from "./schemas";

const MAX_RESULTS = 1_000;
const TTL_MS = 7 * 24 * 60 * 60_000;
const results = new Map<string, { value: MatchResult; expires: number }>();

export function saveResult(result: MatchResult): void {
  if (results.size >= MAX_RESULTS) results.delete(results.keys().next().value as string);
  results.set(result.id, { value: result, expires: Date.now() + TTL_MS });
}

export function getResult(id: string): MatchResult | undefined {
  const hit = results.get(id);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    results.delete(id);
    return undefined;
  }
  return hit.value;
}
