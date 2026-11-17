// "What if I made these resume changes?" Re-runs only the free deterministic stage: no LLM, no cost.
import { z } from "zod";
import { rankAll } from "./prefilter";
import type { RunContext } from "./store";
import type { Job, MatchResult } from "./types";

export const SimulateRequestSchema = z.object({
  resultId: z.uuid(),
  addSkills: z.array(z.string().trim().min(1).max(60)).max(18),
  addTitles: z.array(z.string().trim().min(1).max(100)).max(9),
});
export type SimulateRequest = z.infer<typeof SimulateRequestSchema>;

/**
 * The bar is the lowest prefilter score among jobs that became Strong/Good matches this run (or the
 * shortlist cut-off if none did). Jobs that newly clear it would qualify for AI review.
 */
export function qualifyingBar(ctx: RunContext, result: MatchResult): number {
  const prefilterOf = new Map(ctx.ranked.map((r) => [r.job.id, r.prefilter]));
  const qualified = result.matches.filter((m) => m.tier !== "closest").map((m) => prefilterOf.get(m.job.id) ?? Infinity);
  return qualified.length ? Math.min(...qualified) : (ctx.ranked.at(-1)?.prefilter ?? 0);
}

export function simulate(ctx: RunContext, result: MatchResult, jobs: Job[], req: SimulateRequest) {
  const bar = qualifyingBar(ctx, result);

  const lower = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const haveSkills = lower(ctx.profile.skills);
  const haveTitles = lower(ctx.profile.targetTitles);
  const changed = {
    ...ctx.profile,
    skills: [...ctx.profile.skills, ...req.addSkills.filter((s) => !haveSkills.has(s.toLowerCase()))],
    targetTitles: [...ctx.profile.targetTitles, ...req.addTitles.filter((t) => !haveTitles.has(t.toLowerCase()))].slice(0, 8),
  };

  const before = new Set(rankAll(ctx.profile, jobs).filter((r) => r.prefilter >= bar).map((r) => r.job.id));
  const after = rankAll(changed, jobs).filter((r) => r.prefilter >= bar);
  const newly = after.filter((r) => !before.has(r.job.id));
  return {
    bar: Math.round(bar * 1000) / 1000,
    before: before.size,
    after: after.length,
    added: newly.length,
    examples: newly.slice(0, 5).map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, location: r.locationFit.label })),
  };
}
