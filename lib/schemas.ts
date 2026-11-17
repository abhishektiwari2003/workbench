// Types and zod schemas shared by the API routes, matcher and UI.
import { z } from "zod";
import { tokens } from "./text";

export const RESUME_MIN = 200;
export const RESUME_MAX = 30_000;
/** Fewer distinct words than this is not a resume (e.g. "aaaa..." padding); rejected before any LLM call. */
export const RESUME_MIN_DISTINCT_WORDS = 20;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SHORTLIST_SIZE = 20; // jobs the smart model reads; main cost/quality dial

export const SENIORITY = ["intern", "junior", "mid", "senior", "staff", "principal", "manager", "director"] as const;
export type Seniority = (typeof SENIORITY)[number];

/** What the fast model extracts from a resume. Compact on purpose: it is re-sent with every scoring batch. */
export const ProfileSchema = z.object({
  isResume: z.boolean(), // lets the model say "this is not a resume" instead of inventing a profile
  headline: z.string().max(200),
  seniority: z.enum(SENIORITY),
  yearsExperience: z.number().min(0).max(60),
  targetTitles: z.array(z.string().max(100)).min(1).max(5),
  skills: z.array(z.string().max(60)).max(25),
  domains: z.array(z.string().max(60)).max(6),
  locations: z.array(z.string().max(80)).max(5),
  openToRemote: z.boolean(),
  highlights: z.array(z.string().max(300)).max(5),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** What the smart model returns per job. */
export const JobScoreSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(100),
  reasons: z.array(z.string().max(300)).min(1).max(3),
  gaps: z.array(z.string().max(300)).max(2),
});
export const ScoreBatchSchema = z.object({ results: z.array(JobScoreSchema).max(10) });
export type JobScore = z.infer<typeof JobScoreSchema>;

// Non-strict on purpose: unknown fields are stripped, so older or newer clients keep working.
export const MatchRequestSchema = z.object({
  resumeText: z
    .string({ error: (iss) => (iss.input === undefined ? "resumeText is required" : "resumeText must be text") })
    .trim()
    .min(RESUME_MIN, `Resume must be at least ${RESUME_MIN} characters`)
    .max(RESUME_MAX, `Resume must be at most ${RESUME_MAX.toLocaleString()} characters`)
    .refine(
      (s) => s.length < RESUME_MIN || new Set(tokens(s)).size >= RESUME_MIN_DISTINCT_WORDS,
      "That doesn't look like a resume. Paste the full text of your resume.",
    ),
});

export type Job = {
  id: string; // "<board>:<native id>", unique across boards
  company: string;
  title: string;
  location: string;
  remote: boolean;
  department: string;
  url: string;
  postedAt?: string;
  description: string; // plain text, capped
};
export type JobSummary = Omit<Job, "description">;

export type ScoredJob = { job: JobSummary; score: number; reasons: string[]; gaps: string[] };

export type BoardStatus = { company: string; ok: boolean; count: number; stale?: boolean };

export type MatchCost = { usd: number; calls: number; inputTokens: number; outputTokens: number };

export type MatchResult = {
  id: string;
  createdAt: string;
  profile: Pick<Profile, "headline" | "seniority" | "targetTitles" | "skills" | "locations" | "openToRemote">;
  stats: { jobsScanned: number; boards: BoardStatus[]; analysed: number; unscored?: number; ms: number };
  matches: ScoredJob[]; // score >= STRONG_SCORE
  nearMisses: ScoredJob[]; // NEAR_SCORE..STRONG_SCORE-1
  cost: MatchCost;
};

export const STRONG_SCORE = 75;
export const NEAR_SCORE = 60;
