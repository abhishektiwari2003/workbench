// Monthly LLM cost projection at 1k / 10k / 100k candidates, from measured runs where we have them.
// "Without sharing": every candidate pays a cold run. "With sharing": repeat searches hit the result cache,
// fresh runs read warm job digests, and digesting the catalogue (plus churn) is one shared platform cost.

export const ASSUMPTIONS = {
  repeatShare: 0.2, // share of searches that are repeats served from the result cache
  monthlyChurn: 0.3, // share of the catalogue that is new or changed each month
  // Fallbacks measured on 2026-11-17, used until this process has measured its own runs:
  coldUsd: 0.0346,
  warmUsd: 0.0311,
  digestPerJobUsd: 0.0002,
};

type Run = { computeUsd: number; digestCached: number; digestComputed: number };

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function projection(input: { runs: Run[]; digestUsd: number; digestedJobs: number; jobsTotal: number }) {
  const cold = input.runs.filter((r) => r.digestCached === 0).map((r) => r.computeUsd);
  const warm = input.runs
    .filter((r) => r.digestCached + r.digestComputed > 0 && r.digestCached / (r.digestCached + r.digestComputed) >= 0.8)
    .map((r) => r.computeUsd);
  const coldUsd = avg(cold) ?? ASSUMPTIONS.coldUsd;
  const warmUsd = avg(warm) ?? ASSUMPTIONS.warmUsd;
  const digestPerJobUsd = input.digestedJobs ? input.digestUsd / input.digestedJobs : ASSUMPTIONS.digestPerJobUsd;
  const sharedMonthlyUsd = input.jobsTotal * (1 + ASSUMPTIONS.monthlyChurn) * digestPerJobUsd; // first month: whole catalogue + churn

  const rows = [1_000, 10_000, 100_000].map((n) => {
    const withoutSharing = n * coldUsd;
    const withSharing = n * (1 - ASSUMPTIONS.repeatShare) * warmUsd + sharedMonthlyUsd;
    return { candidates: n, withoutSharing, withSharing, perCandidate: withSharing / n, saving: 1 - withSharing / withoutSharing };
  });
  return {
    coldUsd,
    warmUsd,
    digestPerJobUsd,
    sharedMonthlyUsd,
    measured: { coldRuns: cold.length, warmRuns: warm.length, digestedJobs: input.digestedJobs },
    assumptions: ASSUMPTIONS,
    rows,
  };
}
