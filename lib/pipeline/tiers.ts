// Which jobs get the expensive explanation, and how final scores become Strong / Good / Closest tiers.
import type { Ranked } from "../prefilter";
import { EXPLAIN_MAX, EXPLAIN_MIN, GOOD_SCORE, STRONG_SCORE, type Explained, type FastScore } from "../schemas";
import type { JobSummary, ScoredJob, Tier } from "../types";

/** Jobs the fast model rated Good or better (max EXPLAIN_MAX); at least EXPLAIN_MIN so a result is never empty. */
export function pickForExplain(ranked: Ranked[], fast: Map<string, FastScore>): Ranked[] {
  const scored = ranked.filter((r) => fast.has(r.job.id)).sort((a, b) => fast.get(b.job.id)!.score - fast.get(a.job.id)!.score);
  const good = scored.filter((r) => fast.get(r.job.id)!.score >= GOOD_SCORE).slice(0, EXPLAIN_MAX);
  return good.length >= EXPLAIN_MIN ? good : scored.slice(0, EXPLAIN_MIN);
}

export function summary(job: Ranked["job"]): JobSummary {
  const { description: _d, contentHash: _h, ...rest } = job;
  void _d;
  void _h;
  return rest;
}

/** Builds the scored job: the smart model's calibrated score and reasons, the fast model's sub-scores. */
export function toScoredJob(r: Ranked, fast: FastScore | undefined, ex: Explained | undefined): Omit<ScoredJob, "tier"> {
  return {
    job: summary(r.job),
    score: Math.round(ex?.score ?? fast?.score ?? 0),
    breakdown: {
      skills: Math.round(fast?.skills ?? 0),
      seniority: Math.round(fast?.seniority ?? 0),
      location: Math.round(r.locationFit.score * 100),
      domain: Math.round(fast?.domain ?? 0),
    },
    reasons: ex?.reasons ?? [],
    gaps: ex?.gaps ?? (fast?.gap ? [fast.gap] : []),
    locationFit: r.locationFit,
  };
}

/** Strong >= 70 first, then Good 55-69. If none qualify, the best few are shown honestly as "Closest". */
export function assignTiers(jobs: Omit<ScoredJob, "tier">[], tieBreak: (jobId: string) => number = () => 0): ScoredJob[] {
  const order = (a: { score: number; job: JobSummary }, b: { score: number; job: JobSummary }) =>
    b.score + tieBreak(b.job.id) - (a.score + tieBreak(a.job.id));
  const tierOf = (s: number): Tier | null => (s >= STRONG_SCORE ? "strong" : s >= GOOD_SCORE ? "good" : null);
  const qualified = jobs.filter((j) => tierOf(j.score)).map((j) => ({ ...j, tier: tierOf(j.score)! }));
  if (qualified.length > 0) {
    const strong = qualified.filter((j) => j.tier === "strong").sort(order);
    const good = qualified.filter((j) => j.tier === "good").sort(order);
    return [...strong, ...good];
  }
  return [...jobs].sort(order).slice(0, EXPLAIN_MIN).map((j) => ({ ...j, tier: "closest" as const }));
}
