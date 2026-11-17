// Limits and zod schemas: request validation and the shapes every model reply must satisfy.
import { z } from "zod";
import { tokens } from "./text";

export const RESUME_MIN = 200;
export const RESUME_MAX = 30_000;
/** Fewer distinct words than this is not a resume (e.g. "aaaa..." padding); rejected before any LLM call. */
export const RESUME_MIN_DISTINCT_WORDS = 20;
// Chinese, Japanese and Thai don't separate words with spaces: count their distinct characters as words.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;
const distinctWords = (s: string) => new Set([...tokens(s), ...(s.match(UNSPACED) ?? [])]).size;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const SHORTLIST_SIZE = 40; // jobs the cheap model scores; recall dial
export const EXPLAIN_MAX = 10; // jobs the smart model explains; cost dial
export const EXPLAIN_MIN = 3; // always explain at least this many, so a result is never empty
export const STRONG_SCORE = 70;
export const GOOD_SCORE = 55;
export const BOARD_COUNT = 10;

export const SENIORITY = ["intern", "junior", "mid", "senior", "staff", "principal", "manager", "director"] as const;
export type Seniority = (typeof SENIORITY)[number];

/** What the fast model extracts from a resume. Compact on purpose: it is re-sent with every scoring batch. */
export const ProfileSchema = z.object({
  isResume: z.boolean(), // lets the model say "this is not a resume" instead of inventing a profile
  headline: z.string().max(200),
  seniority: z.enum(SENIORITY),
  yearsExperience: z.number().min(0).max(60),
  country: z.string().max(60).nullable(), // where the candidate lives now
  targetTitles: z.array(z.string().max(100)).min(1).max(5),
  skills: z.array(z.string().max(60)).max(25),
  domains: z.array(z.string().max(60)).max(6),
  locations: z.array(z.string().max(80)).max(5),
  openToRemote: z.boolean(),
  highlights: z.array(z.string().max(300)).max(5),
});
export type Profile = z.infer<typeof ProfileSchema>;

const Pct = z.number().min(0).max(100);

/** Fast model: one score plus sub-scores per job, and the single biggest gap. */
export const FastScoreSchema = z.object({
  results: z
    .array(z.object({ id: z.string(), score: Pct, skills: Pct, seniority: Pct, domain: Pct, gap: z.string().max(200) }))
    .max(12),
});
export type FastScore = z.infer<typeof FastScoreSchema>["results"][number];

/** Smart model: calibrated score with evidence-based reasons and gaps. */
export const ExplainSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        score: Pct,
        reasons: z.array(z.string().max(300)).min(1).max(3),
        gaps: z.array(z.string().max(300)).max(2),
      }),
    )
    .max(8),
});
export type Explained = z.infer<typeof ExplainSchema>["results"][number];

/** Requires every id we sent back exactly, so a skipped job triggers the built-in repair retry. */
export function coversIds<T extends { results: { id: string }[] }>(schema: z.ZodType<T>, ids: string[]) {
  return schema.refine((r) => ids.every((id) => r.results.some((x) => x.id === id)), {
    message: `Include every job id exactly once: ${ids.join(", ")}`,
  });
}

// Non-strict on purpose: unknown fields are stripped, so older or newer clients keep working.
export const MatchRequestSchema = z.object({
  resumeText: z
    .string({ error: (iss) => (iss.input === undefined ? "resumeText is required" : "resumeText must be text") })
    .trim()
    .min(RESUME_MIN, `Resume must be at least ${RESUME_MIN} characters`)
    .max(RESUME_MAX, `Resume must be at most ${RESUME_MAX.toLocaleString()} characters`)
    .refine(
      (s) => s.length < RESUME_MIN || distinctWords(s) >= RESUME_MIN_DISTINCT_WORDS,
      "That doesn't look like a resume. Paste the full text of your resume.",
    ),
});
