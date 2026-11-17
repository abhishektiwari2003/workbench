// Shared job-level cache: the fast model condenses each job's requirements once, keyed by job id +
// content hash, and every candidate reuses it. Cost scales with job churn, not with candidates.
import { z } from "zod";
import { CostMeter } from "./cost";
import { generateJSON } from "./llm";
import { recordCache } from "./metrics";
import { runBatches } from "./pipeline/batch";
import { coversIds } from "./schemas";
import { singleton } from "./singleton";
import { descriptionExcerpt, neutralise } from "./text";
import type { Job } from "./types";

const S = (n: number) => z.string().max(n);
// Lenient on list length (trimmed after parsing) so one extra bullet doesn't cost a retry.
const List = (max: number) => z.array(S(120)).max(20).transform((a) => a.slice(0, max));
const DigestSchema = z.object({
  results: z.array(z.object({ id: z.string(), mustHaves: List(6), niceToHaves: List(4), level: S(60), domain: S(80) })).max(12),
});
export type Digest = Omit<z.infer<typeof DigestSchema>["results"][number], "id">;

const DIGEST_SYSTEM = `You condense job postings into their hiring requirements. Be terse.
For each job return: "mustHaves" (up to 6 required skills/experiences, max 6 words each), "niceToHaves" (up to 4, max 6 words each),
"level" (e.g. "senior IC", "staff IC", "manager", "new grad"), "domain" (product/problem area, max 5 words).
Use only the posting text. Return JSON: {"results":[{"id": string, "mustHaves": string[], "niceToHaves": string[], "level": string, "domain": string}]}
Include every job id you were given, exactly once, ids copied exactly.`;

const BATCH = 5;
const DEADLINE_MS = 120_000;
const BACKGROUND_CONCURRENCY = 2; // never take more than 2 of the 8 model slots from foreground searches
const SOURCE_CHARS = 2_000;
const MAX_ENTRIES = 20_000;
const cache = singleton("digests", () => new Map<string, Digest>());
const keyOf = (j: Job) => `${j.id}:${j.contentHash}`;

/** Digests already in the shared cache (free), recording a hit or miss per job. */
export function warmDigests(jobs: Job[]): Map<string, Digest> {
  const out = new Map<string, Digest>();
  for (const j of jobs) {
    const d = cache.get(keyOf(j));
    recordCache("digest", Boolean(d));
    if (d) out.set(j.id, d);
  }
  return out;
}

const inflight = singleton("digest-inflight", () => new Set<string>()); // never digest the same job twice at once

async function compute(missing: Job[]): Promise<void> {
  const meter = new CostMeter(); // platform cost (shared by every candidate), tracked on /ops via the "job-digest" label
  const { results } = await runBatches(
    missing,
    BATCH,
    (batch) =>
    generateJSON({
      system: DIGEST_SYSTEM,
      input: batch.map((j) => `<job id="${j.id}">\n${neutralise(`${j.title} at ${j.company}`)}\n${neutralise(descriptionExcerpt(j.description, SOURCE_CHARS))}\n</job>`).join("\n\n"),
      schema: coversIds(DigestSchema, batch.map((j) => j.id)),
      model: "fast",
      effort: "low",
      thinking: "disabled", // plain extraction: thinking only burned output tokens and hit the cap
      maxTokens: 1_200,
      label: "job-digest",
      onUsage: meter.for("digest"),
      signal: AbortSignal.timeout(DEADLINE_MS),
    }),
    { concurrency: BACKGROUND_CONCURRENCY },
  );
  const byId = new Map(missing.map((j) => [j.id, j]));
  for (const { id, ...d } of results.flatMap((r) => r.results)) {
    const job = byId.get(id);
    if (!job) continue;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(keyOf(job), d);
  }
}

/**
 * Starts digesting jobs that aren't cached yet, in the background: it never adds latency to a search,
 * and the next candidate whose shortlist overlaps gets them free. Returns how many were scheduled.
 */
export function digestInBackground(jobs: Job[]): number {
  const missing = jobs.filter((j) => !cache.has(keyOf(j)) && !inflight.has(keyOf(j)));
  if (missing.length === 0) return 0;
  missing.forEach((j) => inflight.add(keyOf(j)));
  compute(missing)
    .catch((err) => console.warn(JSON.stringify({ evt: "digest_failed", error: err instanceof Error ? err.message : String(err) })))
    .finally(() => missing.forEach((j) => inflight.delete(keyOf(j))));
  return missing.length;
}

/** How many job digests the shared cache holds (for /ops). */
export function digestCount(): number {
  return cache.size;
}

export function digestText(d: Digest): string {
  return neutralise(
    `Must-haves: ${d.mustHaves.join("; ") || "none stated"}\nNice-to-haves: ${d.niceToHaves.join("; ") || "none"}\nLevel: ${d.level} · Domain: ${d.domain}`,
  );
}
