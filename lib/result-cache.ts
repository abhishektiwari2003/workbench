// Whole-result cache: the same resume against the same job snapshot (and the same feedback state)
// is served instantly, with the original compute cost and a replay of the original progress events.
import { createHash } from "node:crypto";
import type { RunContext } from "./store";
import type { MatchResult, PipelineEvent } from "./types";

type Entry = { result: MatchResult; events: PipelineEvent[]; context: RunContext; snapshotAt: number; expires: number };

const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 500;
const entries = new Map<string, Entry>();

export function resultKey(resumeText: string, prefsKey: string): string {
  return createHash("sha256").update(`${resumeText.trim()}\n${prefsKey}`).digest("hex");
}

/** Only valid while the job snapshot it was computed against is still current. */
export function getCached(key: string, snapshotAt: number | undefined): Entry | undefined {
  const e = entries.get(key);
  if (!e) return undefined;
  if (e.expires < Date.now() || e.snapshotAt !== snapshotAt) {
    entries.delete(key);
    return undefined;
  }
  return e;
}

export function setCached(key: string, e: Omit<Entry, "expires">): void {
  if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  entries.set(key, { ...e, expires: Date.now() + TTL_MS });
}
