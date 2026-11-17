// Deterministic shortlist: ranks ~3,300 jobs against the profile in plain code (free; ~70ms measured),
// so the LLM only reads the jobs that could plausibly be strong matches.
import { locationFit } from "./location";
import type { Profile, Seniority } from "./schemas";
import { termRegex, tokens } from "./text";
import type { Job, LocationFit } from "./types";

// Score = (title + skills + level) x location fit. Tunable with the quality panel, so named here.
const W_TITLE = 0.5; // role match matters most
const W_SKILLS = 0.35;
const W_LEVEL = 0.15;
const SKILL_CAP = 8; // hitting 8 of the candidate's skills counts as full skill coverage
const MIN_SKILL_IF_NO_TITLE = 0.4; // no title overlap: keep only if the stack clearly lines up
const MAX_SKILLS_USED = 20;

// Words that describe level, not role; they must not count as title overlap.
const LEVEL_WORDS = new Set(["senior", "sr", "staff", "principal", "lead", "junior", "jr", "associate", "intern", "head", "chief", "distinguished", "new", "grad", "early", "career", "mid", "level"]);

export const RANK: Record<Seniority, number> = { intern: 0, junior: 1, mid: 2, senior: 3, staff: 4, principal: 5, manager: 3.5, director: 5 };

export function jobLevel(title: string): { rank: number; managerTrack: boolean } {
  const t = title.toLowerCase();
  const managerTrack = /\b(manager|director|head of|vp|vice president)\b/.test(t) && !/\bproduct manager\b|\bprogram manager\b|\baccount manager\b/.test(t);
  if (/\bintern(ship)?\b/.test(t)) return { rank: 0, managerTrack };
  if (/\b(new grad|junior|jr\.?|associate|early career)\b/.test(t)) return { rank: 1, managerTrack };
  if (/\b(principal|distinguished|fellow)\b/.test(t)) return { rank: 5, managerTrack };
  if (/\b(director|head of|vp|vice president)\b/.test(t)) return { rank: 5, managerTrack };
  if (/\bstaff\b/.test(t)) return { rank: 4, managerTrack };
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return { rank: 3, managerTrack };
  // A plain "Engineering Manager" is manager level, not mid level.
  return { rank: managerTrack ? RANK.manager : 2, managerTrack };
}

export function roleTokens(title: string): string[] {
  return tokens(title).filter((t) => !LEVEL_WORDS.has(t));
}

/** Best overlap between the job title and any target title, 0..1. */
function titleScore(jobTitle: string, targets: string[][]): number {
  const jt = new Set(roleTokens(jobTitle));
  let best = 0;
  for (const target of targets) {
    if (target.length === 0) continue;
    best = Math.max(best, target.filter((t) => jt.has(t)).length / target.length);
  }
  return best;
}

function seniorityFit(profile: Profile, title: string): number {
  const job = jobLevel(title);
  const candidateManager = profile.seniority === "manager" || profile.seniority === "director";
  if (job.managerTrack !== candidateManager) return 0.3;
  const diff = Math.abs(RANK[profile.seniority] - job.rank);
  // Ranges, not equality: manager ranks are fractional (3.5), so diffs like 1.5 must land in a band.
  return diff <= 1 ? 1 : diff <= 2 ? 0.5 : 0.1;
}

// Lowercased search text per job, built once per snapshot (jobs are immutable) instead of on every request.
const searchText = new WeakMap<Job, string>();
function textOf(job: Job): string {
  let t = searchText.get(job);
  if (t === undefined) {
    t = `${job.title}\n${job.department}\n${job.description}`.toLowerCase();
    searchText.set(job, t);
  }
  return t;
}

export type Ranked = { job: Job; prefilter: number; locationFit: LocationFit };

/** `nudge` is a per-user adjustment from thumbs up/down (-0.15..+0.15); 0 for anonymous runs. */
export function rankAll(profile: Profile, jobs: Job[], nudge: (job: Job) => number = () => 0): Ranked[] {
  const targets = profile.targetTitles.map(roleTokens);
  const skills = profile.skills.slice(0, MAX_SKILLS_USED);
  const skillRegexes = skills.map(termRegex).filter((r): r is RegExp => r !== null); // compiled once per request
  const ranked: Ranked[] = [];
  for (const job of jobs) {
    const title = titleScore(job.title, targets);
    const text = textOf(job);
    const skillHits = skillRegexes.filter((re) => re.test(text)).length;
    const skill = skills.length ? Math.min(1, skillHits / Math.min(skills.length, SKILL_CAP)) : 0;
    if (title === 0 && skill < MIN_SKILL_IF_NO_TITLE) continue; // neither the role nor the stack lines up
    const fit = locationFit(profile.country, job);
    const base = (W_TITLE * title + W_SKILLS * skill + W_LEVEL * seniorityFit(profile, job.title)) * fit.score;
    ranked.push({ job, prefilter: Math.round((base + nudge(job)) * 1000) / 1000, locationFit: fit });
  }
  return ranked.sort((a, b) => b.prefilter - a.prefilter);
}

/**
 * Top `limit` jobs, with re-posts of the same role (same company + title, e.g. one posting per city)
 * collapsed to the one that fits best: no paying the model twice for the same job.
 */
export function shortlist(profile: Profile, jobs: Job[], limit: number, nudge?: (job: Job) => number): Ranked[] {
  const seen = new Set<string>();
  const out: Ranked[] = [];
  for (const r of rankAll(profile, jobs, nudge)) {
    const key = `${r.job.company}|${r.job.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length === limit) break;
  }
  return out;
}
