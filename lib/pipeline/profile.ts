// Stage 1: resume -> profile (fast model), then deterministic checks that keep it honest.
import { AppError } from "../api";
import type { CostMeter } from "../cost";
import { generateJSON } from "../llm";
import { normaliseCountry } from "../location";
import { jobLevel, RANK } from "../prefilter";
import { PROFILE_SYSTEM } from "../prompts";
import { ProfileSchema, type Profile, type Seniority } from "../schemas";
import { containsTerm } from "../text";

/** Keeps only skills that actually appear in the resume, so an invented skill can't steer the shortlist. */
export function groundSkills(profile: Profile, resumeText: string): Profile {
  const lower = resumeText.toLowerCase();
  const grounded = profile.skills.filter((s) => containsTerm(lower, s));
  // A translated resume may name no skill verbatim; then keep the model's list rather than none.
  return grounded.length ? { ...profile, skills: grounded } : profile;
}

const joinThousands = (s: string) => s.replace(/(\d),(\d)/g, "$1$2"); // "1,200" and "1200" compare equal

/** Highlights reach Sonnet as the candidate's evidence: drop any that cite a number the resume doesn't contain. */
export function groundHighlights(profile: Profile, resumeText: string): Profile {
  const resume = joinThousands(resumeText);
  const grounded = (h: string) => (joinThousands(h).match(/\d+(?:\.\d+)?/g) ?? []).every((n) => resume.includes(n));
  return { ...profile, highlights: profile.highlights.filter(grounded) };
}

const LEVEL_BY_RANK: Record<number, Seniority> = { 0: "intern", 1: "junior", 2: "mid", 3: "senior", 4: "staff", 5: "principal" };
const LEVEL_WORDS = /\b(senior|sr\.?|staff|principal|lead|distinguished|head of)\s*/gi;

/** Highest IC level that years of experience support. Lenient at the edges: titles vary by company. */
export function maxRankForYears(years: number): number {
  return years >= 12 ? 5 : years >= 8 ? 4 : years >= 5 ? 3 : years >= 2 ? 2 : 1;
}

/** Target titles (and seniority) must fit yearsExperience: no "Staff" titles for a 4-year engineer. */
export function fitTitlesToYears(p: Profile): Profile {
  const maxRank = maxRankForYears(p.yearsExperience);
  const isManager = p.seniority === "manager" || p.seniority === "director";
  const fits = (t: string) => {
    const l = jobLevel(t);
    return l.managerTrack ? isManager || p.yearsExperience >= 6 : l.rank <= maxRank;
  };
  const kept = p.targetTitles.filter(fits);
  const targetTitles = kept.length
    ? kept
    : [...new Set(p.targetTitles.map((t) => t.replace(LEVEL_WORDS, "").replace(/\s+/g, " ").trim()).filter(Boolean))];
  const seniority = !isManager && RANK[p.seniority] > maxRank ? LEVEL_BY_RANK[maxRank] : p.seniority;
  return { ...p, targetTitles, seniority };
}

export async function buildProfile(resumeText: string, meter: CostMeter, signal: AbortSignal): Promise<Profile> {
  const extracted = await generateJSON({
    system: PROFILE_SYSTEM,
    input: resumeText,
    schema: ProfileSchema,
    model: "fast",
    effort: "low",
    thinking: "disabled", // structured extraction on the critical path: no reasoning needed, saves ~1s
    maxTokens: 1_200,
    label: "resume-profile",
    onUsage: meter.for("profile"),
    signal,
  });
  if (!extracted.isResume) {
    throw new AppError("That doesn't look like a resume. Paste or upload your resume and try again.", 422, "not_a_resume");
  }
  const country = normaliseCountry(extracted.country) ?? normaliseCountry(extracted.locations.join("; "));
  return fitTitlesToYears(groundHighlights(groundSkills({ ...extracted, country }, resumeText), resumeText));
}
