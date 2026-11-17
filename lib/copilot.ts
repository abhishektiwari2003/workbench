// Career copilot: on-demand, fast-tier actions on a stored run. Each returns its own cost.
import { z } from "zod";
import { AppError } from "./api";
import { CostMeter } from "./cost";
import { generateJSON } from "./llm";
import { COACH_SYSTEM, coachInput, jobActionInput, OUTREACH_SYSTEM, PREP_SYSTEM, TAILOR_SYSTEM } from "./prompts-copilot";
import type { RunContext } from "./store";
import { tokens } from "./text";
import type { MatchResult } from "./types";

const Short = (n: number) => z.string().max(n);

export const CoachSchema = z.object({
  changes: z
    .array(
      z.object({
        change: Short(300),
        why: Short(300),
        addSkills: z.array(Short(60)).max(6),
        addTitles: z.array(Short(100)).max(3),
        jobIds: z.array(z.string()).max(20),
      }),
    )
    .min(1)
    .max(3),
});
const TailorSchema = z.object({ bullets: z.array(z.object({ before: Short(500), after: Short(400) })).min(1).max(3) });
const OutreachSchema = z.object({ subject: Short(150), message: Short(1500) });
const PrepSchema = z.object({ questions: z.array(z.object({ question: Short(300), why: Short(300) })).min(1).max(5) });

export const CopilotRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("coach"), resultId: z.uuid() }),
  z.object({ action: z.enum(["tailor", "outreach", "prep"]), resultId: z.uuid(), jobId: z.string().max(120) }),
]);
export type CopilotRequest = z.infer<typeof CopilotRequestSchema>;

const COACH_TOP = 20; // gaps across the top 20 scored jobs
const TIMEOUT_MS = 40_000; // a click never hangs longer than this, retries included
const GROUNDED = 0.6; // share of a "before" bullet's words that must appear in the resume

/** A tailored "before" must quote the resume: drop bullets whose original the model made up. */
function groundBullets(bullets: { before: string; after: string }[], resumeText: string) {
  const have = new Set(tokens(resumeText));
  const kept = bullets.filter((b) => {
    const t = tokens(b.before);
    return t.length > 0 && t.filter((x) => have.has(x)).length / t.length >= GROUNDED;
  });
  if (!kept.length) throw new AppError("We couldn't tailor this role reliably. Please try again.", 502, "ungrounded");
  return { bullets: kept };
}

export async function runCopilot(req: CopilotRequest, ctx: RunContext, result: MatchResult) {
  const meter = new CostMeter();
  const common = { model: "fast" as const, effort: "low" as const, onUsage: meter.for("copilot"), signal: AbortSignal.timeout(TIMEOUT_MS) };
  const explainedGaps = new Map(result.matches.map((m) => [m.job.id, m.gaps]));
  const gapsFor = (id: string) => explainedGaps.get(id) ?? (ctx.fast.get(id)?.gap ? [ctx.fast.get(id)!.gap] : []);

  let output: unknown;
  if (req.action === "coach") {
    const top = ctx.ranked
      .filter((r) => ctx.fast.has(r.job.id))
      .sort((a, b) => ctx.fast.get(b.job.id)!.score - ctx.fast.get(a.job.id)!.score)
      .slice(0, COACH_TOP)
      .map((r) => ({ id: r.job.id, title: r.job.title, company: r.job.company, score: ctx.fast.get(r.job.id)!.score, gaps: gapsFor(r.job.id) }));
    const coach = await generateJSON({ ...common, system: COACH_SYSTEM, input: coachInput(ctx.profile, top), schema: CoachSchema, maxTokens: 1_500, label: "copilot-coach" });
    const known = new Map(top.map((j) => [j.id, j]));
    // Keep only job ids we actually sent, and attach titles so the UI can link to them.
    output = {
      changes: coach.changes.map((c) => ({
        ...c,
        jobs: [...new Set(c.jobIds)].filter((id) => known.has(id)).map((id) => ({ id, title: known.get(id)!.title, company: known.get(id)!.company })),
      })),
    };
  } else {
    const ranked = ctx.ranked.find((r) => r.job.id === req.jobId);
    if (!ranked) throw new AppError("That job isn't part of this search.", 404, "job_not_found");
    const input = jobActionInput(ctx.resumeText, ranked.job, gapsFor(req.jobId));
    const label = `copilot-${req.action}`;
    output =
      req.action === "tailor"
        ? groundBullets((await generateJSON({ ...common, system: TAILOR_SYSTEM, input, schema: TailorSchema, maxTokens: 1_200, label })).bullets, ctx.resumeText)
        : req.action === "outreach"
          ? await generateJSON({ ...common, system: OUTREACH_SYSTEM, input, schema: OutreachSchema, maxTokens: 900, label })
          : await generateJSON({ ...common, system: PREP_SYSTEM, input, schema: PrepSchema, maxTokens: 1_400, label });
  }
  const cost = meter.total();
  return { output, costUsd: cost.computeUsd, cached: cost.spentUsd === 0 && cost.calls > 0 };
}
