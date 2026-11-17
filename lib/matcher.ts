// The matching pipeline: resume -> profile (fast model) -> deterministic shortlist -> scored matches (smart model).
import { createHash, randomUUID } from "node:crypto";
import { AppError } from "./api";
import { getJobs } from "./boards";
import { CostMeter } from "./cost";
import { generateJSON, LLMError } from "./llm";
import { shortlist, type Ranked } from "./prefilter";
import { PROFILE_SYSTEM, SCORE_SYSTEM, scoreInput } from "./prompts";
import {
  NEAR_SCORE,
  ProfileSchema,
  ScoreBatchSchema,
  SHORTLIST_SIZE,
  STRONG_SCORE,
  type MatchResult,
  type Profile,
  type ScoredJob,
} from "./schemas";
import { saveResult } from "./store";
import { containsTerm } from "./text";

const BATCH_SIZE = 5; // jobs per scoring call; batches run in parallel
const DEADLINE_MS = 45_000; // whole pipeline; beyond this we return a clean 504 instead of hanging

export function extractProfile(resumeText: string, meter: CostMeter, signal?: AbortSignal): Promise<Profile> {
  return generateJSON({
    system: PROFILE_SYSTEM,
    input: resumeText,
    schema: ProfileSchema,
    model: "fast",
    effort: "low",
    maxTokens: 1_200,
    label: "resume-profile",
    onUsage: meter.record,
    signal,
  });
}

/** Keeps only skills that actually appear in the resume, so an invented skill can't steer the shortlist. */
function groundSkills(profile: Profile, resumeText: string): Profile {
  const lower = resumeText.toLowerCase();
  const grounded = profile.skills.filter((s) => containsTerm(lower, s));
  // A translated resume may name no skill verbatim; then keep the model's list rather than none.
  return grounded.length ? { ...profile, skills: grounded } : profile;
}

async function scoreShortlist(profile: Profile, ranked: Ranked[], meter: CostMeter, signal: AbortSignal): Promise<ScoredJob[]> {
  const batches: Ranked[][] = [];
  for (let i = 0; i < ranked.length; i += BATCH_SIZE) batches.push(ranked.slice(i, i + BATCH_SIZE));

  const settled = await Promise.allSettled(
    batches.map((batch) =>
      generateJSON({
        system: SCORE_SYSTEM,
        input: scoreInput(profile, batch.map((r) => r.job)),
        schema: ScoreBatchSchema,
        model: "smart",
        effort: "low",
        maxTokens: 2_000,
        label: "match-score",
        onUsage: meter.record,
        signal,
      }),
    ),
  );

  // One failed batch should not sink the whole result; all failing should.
  const failures = settled.filter((s) => s.status === "rejected");
  for (const f of failures) {
    const reason = f.reason;
    console.warn(JSON.stringify({ evt: "score_batch_failed", error: reason instanceof Error ? reason.message : String(reason) }));
  }
  if (failures.length === settled.length && failures.length > 0) {
    const reason = failures[0].reason;
    throw reason instanceof LLMError ? reason : new LLMError("Scoring failed", "api");
  }

  const byId = new Map(ranked.map((r) => [r.job.id, r.job]));
  const scored: ScoredJob[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value.results) {
      const job = byId.get(r.id);
      if (!job) continue; // ignore ids the model made up
      byId.delete(r.id); // and duplicates
      const summary = { id: job.id, company: job.company, title: job.title, location: job.location, remote: job.remote, department: job.department, url: job.url, postedAt: job.postedAt };
      scored.push({ job: summary, score: Math.round(r.score), reasons: r.reasons, gaps: r.gaps });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}

async function run(resumeText: string): Promise<MatchResult> {
  const started = Date.now();
  const meter = new CostMeter();
  const signal = AbortSignal.timeout(DEADLINE_MS);
  // Board fetch and profile extraction are independent: run them together.
  const [extracted, snapshot] = await Promise.all([extractProfile(resumeText, meter, signal), getJobs()]);
  if (!extracted.isResume) {
    throw new AppError("That doesn't look like a resume. Paste or upload your resume and try again.", 422, "not_a_resume");
  }
  const profile = groundSkills(extracted, resumeText);
  const ranked = shortlist(profile, snapshot.jobs, SHORTLIST_SIZE);
  const scored = ranked.length ? await scoreShortlist(profile, ranked, meter, signal) : [];

  const result: MatchResult = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    profile: {
      headline: profile.headline,
      seniority: profile.seniority,
      targetTitles: profile.targetTitles,
      skills: profile.skills.slice(0, 12),
      locations: profile.locations,
      openToRemote: profile.openToRemote,
    },
    stats: {
      jobsScanned: snapshot.jobs.length,
      boards: snapshot.boards,
      analysed: scored.length,
      unscored: ranked.length - scored.length, // failed batches or ids the model skipped; shown to the user
      ms: Date.now() - started,
    },
    matches: scored.filter((s) => s.score >= STRONG_SCORE),
    nearMisses: scored.filter((s) => s.score >= NEAR_SCORE && s.score < STRONG_SCORE),
    cost: meter.total(),
  };
  saveResult(result);
  return result;
}

// Single-flight: identical resumes submitted concurrently (double click, two tabs, retry after refresh)
// share one pipeline run and one result id, so the second caller costs $0.
const inflight = new Map<string, Promise<MatchResult>>();

export function runMatch(resumeText: string): Promise<MatchResult> {
  const key = createHash("sha256").update(resumeText.trim()).digest("hex");
  let p = inflight.get(key);
  if (!p) {
    p = run(resumeText).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
