// Thumbs up/down -> a small, explainable ranking nudge for that user's future searches.
// Liked companies and role words get a boost, disliked ones a penalty, capped at +-0.15 of the prefilter score.
import { createHash } from "node:crypto";
import { roleTokens } from "./prefilter";
import type { Job } from "./types";
import type { Vote } from "./users";

const COMPANY_WEIGHT = 0.05;
const ROLE_WORD_WEIGHT = 0.02;
const CAP = 0.15;

export function nudgeFrom(votes: Map<string, Vote>): ((job: Job) => number) | undefined {
  if (votes.size === 0) return undefined;
  const company = new Map<string, number>();
  const words = new Map<string, number>();
  for (const v of votes.values()) {
    company.set(v.company, (company.get(v.company) ?? 0) + v.vote * COMPANY_WEIGHT);
    for (const w of new Set(roleTokens(v.title))) words.set(w, (words.get(w) ?? 0) + v.vote * ROLE_WORD_WEIGHT);
  }
  return (job: Job) => {
    let n = company.get(job.company) ?? 0;
    for (const w of new Set(roleTokens(job.title))) n += words.get(w) ?? 0;
    return Math.max(-CAP, Math.min(CAP, n));
  };
}

/** Changes whenever the votes change, so cached rankings never ignore new feedback. "" = no feedback. */
export function prefsKeyFrom(votes: Map<string, Vote>): string {
  if (votes.size === 0) return "";
  const canonical = [...votes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, v]) => `${id}:${v.vote}`);
  return createHash("sha256").update(canonical.join("|")).digest("hex").slice(0, 16);
}
