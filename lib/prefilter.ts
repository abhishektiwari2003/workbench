// Deterministic shortlist: ranks ~3,000 jobs against the profile in plain code (free, ~10ms),
// so the LLM only reads the ~20 jobs that could plausibly be strong matches.
import type { Job, Profile, Seniority } from "./schemas";
import { termRegex, tokens } from "./text";

// Words that describe level, not role; they must not count as title overlap.
const LEVEL_WORDS = new Set(["senior", "sr", "staff", "principal", "lead", "junior", "jr", "associate", "intern", "head", "chief", "distinguished", "new", "grad", "early", "career", "mid", "level"]);

const RANK: Record<Seniority, number> = { intern: 0, junior: 1, mid: 2, senior: 3, staff: 4, principal: 5, manager: 3.5, director: 5 };

function jobLevel(title: string): { rank: number; managerTrack: boolean } {
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

function roleTokens(title: string): string[] {
  return tokens(title).filter((t) => !LEVEL_WORDS.has(t));
}

/** Best overlap between the job title and any target title, 0..1. */
function titleScore(jobTitle: string, targets: string[][]): number {
  const jt = new Set(roleTokens(jobTitle));
  let best = 0;
  for (const target of targets) {
    if (target.length === 0) continue;
    const hits = target.filter((t) => jt.has(t)).length;
    best = Math.max(best, hits / target.length);
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

function locationFit(profile: Profile, job: Job): number {
  if (profile.locations.length === 0) return 1;
  if (job.remote && profile.openToRemote) return 1;
  const loc = job.location.toLowerCase();
  const near = profile.locations.some((l) => {
    const city = l.split(",")[0].trim().toLowerCase();
    return city.length > 1 && loc.includes(city);
  });
  return near ? 1 : 0.6; // soft penalty: the LLM still sees location and can judge relocation
}

export type Ranked = { job: Job; prefilter: number };

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

export function shortlist(profile: Profile, jobs: Job[], limit: number): Ranked[] {
  const targets = profile.targetTitles.map(roleTokens);
  const skills = profile.skills.slice(0, 20);
  const skillRegexes = skills.map(termRegex).filter((r): r is RegExp => r !== null); // compiled once per request
  const ranked: Ranked[] = [];
  for (const job of jobs) {
    const title = titleScore(job.title, targets);
    const text = textOf(job);
    const skillHits = skillRegexes.filter((re) => re.test(text)).length;
    const skill = skills.length ? Math.min(1, skillHits / Math.min(skills.length, 8)) : 0;
    if (title === 0 && skill < 0.4) continue; // neither the role nor the stack lines up
    const score = (0.5 * title + 0.35 * skill + 0.15 * seniorityFit(profile, job.title)) * locationFit(profile, job);
    ranked.push({ job, prefilter: Math.round(score * 100) / 100 });
  }
  ranked.sort((a, b) => b.prefilter - a.prefilter);
  return ranked.slice(0, limit);
}
