// Quality check: the smart model independently judges our top 5 matches and the 5 most borderline jobs
// we rejected, without seeing our scores. Agreement, precision of the top 5 and false-negative rate.
import { z } from "zod";
import { CostMeter } from "./cost";
import { warmDigests } from "./digests";
import { generateJSON } from "./llm";
import { recordQuality } from "./metrics";
import type { Ranked } from "./prefilter";
import { jobsInput } from "./prompts";
import { coversIds, GOOD_SCORE } from "./schemas";
import type { RunContext } from "./store";
import type { MatchResult } from "./types";

const JUDGE_SYSTEM = `You are an independent hiring reviewer. For each job, decide whether this candidate should apply.
Judge role fit, level, must-have skills, domain and the given location fit. You have not seen any other system's opinion.
"apply" = a strong or good use of the candidate's time; "skip" = not worth applying.
Refer to the candidate as "the candidate", never with gendered pronouns.
Return JSON: {"results":[{"id": string, "verdict": "apply"|"skip", "reason": string (max 20 words)}]}
Include every job id you were given, exactly once, ids copied exactly.`;

const JudgeSchema = z.object({
  results: z.array(z.object({ id: z.string(), verdict: z.enum(["apply", "skip"]), reason: z.string().max(300) })).max(12),
});

const SAMPLE = 5;

export async function judgeQuality(ctx: RunContext, result: MatchResult) {
  const byId = new Map(ctx.ranked.map((r) => [r.job.id, r]));
  const top = result.matches.slice(0, SAMPLE).map((m) => byId.get(m.job.id)).filter((r): r is Ranked => !!r);
  const shown = new Set(result.matches.map((m) => m.job.id));
  // Hardest negatives: the rejected jobs the fast model scored highest (closest to the bar).
  const rejected = ctx.ranked
    .filter((r) => !shown.has(r.job.id) && (ctx.fast.get(r.job.id)?.score ?? 0) < GOOD_SCORE)
    .sort((a, b) => (ctx.fast.get(b.job.id)?.score ?? 0) - (ctx.fast.get(a.job.id)?.score ?? 0))
    .slice(0, SAMPLE);
  const sample = [...top, ...rejected].sort((a, b) => a.job.id.localeCompare(b.job.id)); // order hides which group a job is in

  const meter = new CostMeter();
  const judged = await generateJSON({
    system: JUDGE_SYSTEM,
    input: jobsInput(ctx.profile, sample, 1_400, warmDigests(sample.map((r) => r.job)), 700),
    schema: coversIds(JudgeSchema, sample.map((r) => r.job.id)),
    model: "smart",
    effort: "low",
    maxTokens: 2_000,
    label: "quality-judge",
    onUsage: meter.for("quality"),
    signal: AbortSignal.timeout(40_000), // a click never hangs longer than this, retries included
  });
  const verdict = new Map(judged.results.map((r) => [r.id, r]));
  const topIds = new Set(top.map((r) => r.job.id));
  const items = sample.map((r) => {
    const ours = topIds.has(r.job.id) ? "match" : "rejected";
    const v = verdict.get(r.job.id);
    const score = result.matches.find((m) => m.job.id === r.job.id)?.score ?? Math.round(ctx.fast.get(r.job.id)?.score ?? 0);
    return {
      id: r.job.id,
      title: r.job.title,
      company: r.job.company,
      ours,
      ourScore: score,
      verdict: v?.verdict ?? "skip",
      reason: v?.reason ?? "",
      agrees: (ours === "match") === (v?.verdict === "apply"),
    };
  });
  const ofGroup = (g: string) => items.filter((i) => i.ours === g);
  const rate = (xs: typeof items, pred: (i: (typeof items)[number]) => boolean) => (xs.length ? xs.filter(pred).length / xs.length : 0);
  const cost = meter.total();
  const report = {
    agreement: rate(items, (i) => i.agrees),
    precisionAt5: rate(ofGroup("match"), (i) => i.verdict === "apply"),
    falseNegativeRate: rate(ofGroup("rejected"), (i) => i.verdict === "apply"),
    sampled: { matches: top.length, rejected: rejected.length },
    costUsd: cost.computeUsd,
    cached: cost.spentUsd === 0 && cost.calls > 0,
    items: items.sort((a, b) => (a.ours === b.ours ? b.ourScore - a.ourScore : a.ours === "match" ? -1 : 1)),
  };
  if (!report.cached) recordQuality(report.agreement, report.precisionAt5, report.falseNegativeRate);
  return report;
}
