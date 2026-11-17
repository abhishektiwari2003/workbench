// Stage 3 and 4: the fast model scores the whole shortlist; the smart model explains and calibrates the best.
import type { CostMeter } from "../cost";
import { generateJSON } from "../llm";
import type { Ranked } from "../prefilter";
import { EXPLAIN_SYSTEM, FAST_SCORE_SYSTEM, jobsInput } from "../prompts";
import { coversIds, ExplainSchema, FastScoreSchema, type Explained, type FastScore, type Profile } from "../schemas";
import type { Digest } from "../digests";
import { runBatches } from "./batch";

const FAST_BATCH = 10;
const EXPLAIN_BATCH = 5;
const FAST_EXCERPT = 1_200;
const EXPLAIN_EXCERPT = 1_400;
const FAST_WITH_DIGEST = 400; // with a digest, a shorter raw excerpt is enough
const EXPLAIN_WITH_DIGEST = 700;

type Ctx = { profile: Profile; meter: CostMeter; signal: AbortSignal; digests?: Map<string, Digest> };

export async function fastScore(ranked: Ranked[], { profile, meter, signal, digests }: Ctx, onBatch: (n: number) => void) {
  const { results, failed } = await runBatches(
    ranked,
    FAST_BATCH,
    (batch) =>
      generateJSON({
        system: FAST_SCORE_SYSTEM,
        input: jobsInput(profile, batch, FAST_EXCERPT, digests, FAST_WITH_DIGEST),
        schema: coversIds(FastScoreSchema, batch.map((r) => r.job.id)),
        model: "fast",
        effort: "low",
        maxTokens: 1_500,
        label: "match-score",
        onUsage: meter.for("score"),
        signal,
      }),
    { onDone: (batch) => onBatch(batch.length) },
  );
  const ids = new Set(ranked.map((r) => r.job.id));
  const scores = new Map<string, FastScore>();
  for (const r of results.flatMap((x) => x.results)) if (ids.has(r.id) && !scores.has(r.id)) scores.set(r.id, r);
  return { scores, failed };
}

export async function explain(ranked: Ranked[], { profile, meter, signal, digests }: Ctx, onBatch: (n: number) => void) {
  const { results } = await runBatches(
    ranked,
    EXPLAIN_BATCH,
    (batch) =>
      generateJSON({
        system: EXPLAIN_SYSTEM,
        input: jobsInput(profile, batch, EXPLAIN_EXCERPT, digests, EXPLAIN_WITH_DIGEST),
        schema: coversIds(ExplainSchema, batch.map((r) => r.job.id)),
        model: "smart",
        effort: "low",
        maxTokens: 2_000,
        label: "match-explain",
        onUsage: meter.for("explain"),
        signal,
      }),
    { onDone: (batch) => onBatch(batch.length) },
  );
  const ids = new Set(ranked.map((r) => r.job.id));
  const explained = new Map<string, Explained>();
  for (const r of results.flatMap((x) => x.results)) if (ids.has(r.id) && !explained.has(r.id)) explained.set(r.id, r);
  return explained;
}
