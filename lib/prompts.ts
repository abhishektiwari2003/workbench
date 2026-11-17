// Static system prompts (no user data) and compact input builders.
// Note: these prompts are below the minimum cacheable prefix, so savings come from the response cache, not prompt caching.
import type { Job, Profile } from "./schemas";
import { descriptionExcerpt } from "./text";

export const PROFILE_SYSTEM = `You read a candidate's resume and extract a compact job-search profile.
The resume may be in any language; write the profile in English.
If the text is not a resume or CV (e.g. a job posting, cover letter, essay, or filler text), set "isResume": false and fill the other fields minimally.

Return JSON with exactly these keys:
{
  "isResume": boolean,          // true only if this is a person's resume/CV
  "headline": string,           // e.g. "Senior backend engineer, 7 yrs, payments and distributed systems"
  "seniority": "intern"|"junior"|"mid"|"senior"|"staff"|"principal"|"manager"|"director",
  "yearsExperience": number,
  "targetTitles": string[],     // 2-5 job titles this person should apply for next, as companies phrase them
  "skills": string[],           // up to 20 concrete skills/technologies, most important first, short canonical names ("Go", "Kubernetes", "React")
  "domains": string[],          // up to 6 industries or problem areas ("payments", "developer tools")
  "locations": string[],        // cities/countries they live in or ask for; [] if unknown
  "openToRemote": boolean,      // true unless the resume says on-site only
  "highlights": string[]        // up to 5 strongest achievements, one short line each, with numbers when present
}
Base everything on the resume only. Do not invent skills.`;

export const SCORE_SYSTEM = `You are a demanding technical recruiter. For each job, judge how strong a match it is for the candidate.

Scoring rubric (0-100):
- 85-100: would very likely pass a recruiter screen; role, level and core skills all line up
- 75-84: strong match with one minor gap
- 60-74: plausible but a real gap (level, key skill, domain or location)
- below 60: not a good use of the candidate's time
Weigh: role and level fit first, then must-have skills, then domain, then location/remote.
Be strict and consistent. Do not reward keyword overlap alone.
Use only the job text and candidate profile given. Never assume facts about a company (its tech stack, team, culture) that the job text does not state.

For every job return:
- "reasons": 1-3 short lines (max ~20 words each) naming concrete evidence from the candidate profile that fits this job
- "gaps": 0-2 short lines naming the most important requirement the job text states that the candidate lacks; [] if there is no real gap

Return JSON: {"results":[{"id": string, "score": number, "reasons": string[], "gaps": string[]}]}
Include every job id you were given, exactly once, ids copied exactly.`;

/** Board and resume text must not be able to close our <job>/<candidate> wrappers (prompt injection). */
function neutralise(s: string): string {
  return s.replace(/<(\/?)(job|candidate|user_input)/gi, "&lt;$1$2");
}

/** Only the fields that matter for fit: keeps every scoring call small. */
export function profileForScoring(p: Profile): string {
  return neutralise(JSON.stringify({
    headline: p.headline,
    seniority: p.seniority,
    yearsExperience: p.yearsExperience,
    skills: p.skills,
    domains: p.domains,
    locations: p.locations,
    openToRemote: p.openToRemote,
    highlights: p.highlights,
  }));
}

export const EXCERPT_CHARS = 1_400;

export function scoreInput(profile: Profile, jobs: Job[]): string {
  const jobBlocks = jobs.map((j) =>
    [
      `<job id="${j.id}">`,
      neutralise(`Title: ${j.title}`),
      neutralise(`Company: ${j.company}${j.department ? ` / ${j.department}` : ""}`),
      neutralise(`Location: ${j.location}${j.remote ? " (remote possible)" : ""}`),
      neutralise(descriptionExcerpt(j.description, EXCERPT_CHARS)),
      `</job>`,
    ].join("\n"),
  );
  return `<candidate>\n${profileForScoring(profile)}\n</candidate>\n\n${jobBlocks.join("\n\n")}`;
}
