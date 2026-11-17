// Static system prompts (no user data) and compact input builders for the match pipeline.
// The prompts sit below the minimum cacheable prefix, so savings come from the response cache, not prompt caching.
import type { Ranked } from "./prefilter";
import type { Profile } from "./schemas";
import { descriptionExcerpt, neutralise } from "./text";

export { neutralise };
import { digestText, type Digest } from "./digests";

export const PROFILE_SYSTEM = `You read a candidate's resume and extract a compact job-search profile.
The resume may be in any language; write the profile in English.
If the text is not a resume or CV (e.g. a job posting, cover letter, essay, or filler text), set "isResume": false and fill the other fields minimally.

Return JSON with exactly these keys:
{
  "isResume": boolean,          // true only if this is a person's resume/CV
  "headline": string,           // e.g. "Senior backend engineer, 7 yrs, payments and distributed systems"
  "seniority": "intern"|"junior"|"mid"|"senior"|"staff"|"principal"|"manager"|"director",
  "yearsExperience": number,    // total professional years, from the dates in the resume
  "country": string | null,     // country the candidate lives in now, in English (e.g. "India"); null if unknown
  "targetTitles": string[],     // 2-5 job titles this person should apply for next, as companies phrase them
  "skills": string[],           // up to 20 concrete skills/technologies, most important first, short canonical names ("Go", "Kubernetes")
  "domains": string[],          // up to 6 industries or problem areas ("payments", "developer tools")
  "locations": string[],        // cities/countries they live in or ask for; [] if unknown
  "openToRemote": boolean,      // true unless the resume says on-site only
  "highlights": string[]        // up to 5 strongest achievements, one short line each, with numbers when present
}
Target titles must fit yearsExperience: 0-2 years junior or entry-level, 3-5 mid-level, 6-9 senior,
10+ staff/principal or manager if they have led teams. Never suggest a level above that.
Base everything on the resume only. Do not invent skills.`;

export const FAST_SCORE_SYSTEM = `You screen jobs for a candidate. For each job give a quick, strict fit score.

Scores are 0-100:
- "score": overall fit. 85+ excellent; 70-84 strong (would likely pass a recruiter screen); 55-69 good but a real gap; below 55 not worth applying.
- "skills": how well the candidate's skills cover the job's stated must-haves.
- "seniority": how well the candidate's level and years fit the role's level.
- "domain": how close the candidate's industry/problem-area experience is.
- "gap": the single most important stated requirement the candidate lacks, max 12 words; "" if none.
Each job shows a "Location fit" line already computed for this candidate; weigh it in "score" (poor location fit lowers it).
Use only the job text and candidate profile given. Do not reward keyword overlap alone.

Return JSON: {"results":[{"id": string, "score": number, "skills": number, "seniority": number, "domain": number, "gap": string}]}
Include every job id you were given, exactly once, ids copied exactly.`;

export const EXPLAIN_SYSTEM = `You are a demanding technical recruiter. For each job, give a calibrated match score and explain it.

Scoring rubric (0-100):
- 85-100: excellent; role, level and core skills all line up
- 70-84: strong; would very likely pass a recruiter screen, at most one minor gap
- 55-69: good; plausible but with a real gap (level, key skill, domain or location)
- below 55: not a good use of the candidate's time
Weigh: role and level fit first, then must-have skills, then domain, then the given location fit.
Be strict and consistent. Use only the job text and candidate profile given. Never assume facts about a company
(its tech stack, team, culture) that the job text does not state. Refer to the candidate as "the candidate" or "you",
never with gendered pronouns.

For every job return:
- "reasons": 1-3 short lines (max ~20 words each) naming concrete evidence from the candidate profile that fits this job
- "gaps": 0-2 short lines naming the most important requirement the job text states that the candidate lacks; [] if there is no real gap

Return JSON: {"results":[{"id": string, "score": number, "reasons": string[], "gaps": string[]}]}
Include every job id you were given, exactly once, ids copied exactly.`;


/** Only the fields that matter for fit: keeps every scoring call small. */
export function profileForScoring(p: Profile): string {
  return neutralise(
    JSON.stringify({
      headline: p.headline,
      seniority: p.seniority,
      yearsExperience: p.yearsExperience,
      country: p.country,
      skills: p.skills,
      domains: p.domains,
      openToRemote: p.openToRemote,
      highlights: p.highlights,
    }),
  );
}

/**
 * Job blocks with the deterministic location verdict included, so the model never guesses geography.
 * With a cached digest, the block carries the condensed requirements plus a shorter excerpt (fewer tokens).
 */
export function jobsInput(profile: Profile, ranked: Ranked[], excerptChars: number, digests?: Map<string, Digest>, digestExcerptChars = 500): string {
  const blocks = ranked.map(({ job: j, locationFit }) => {
    const digest = digests?.get(j.id);
    return [
      `<job id="${j.id}">`,
      neutralise(`Title: ${j.title}`),
      neutralise(`Company: ${j.company}${j.department ? ` / ${j.department}` : ""}`),
      neutralise(`Location: ${j.location}`),
      `Location fit for this candidate: ${locationFit.label} (${Math.round(locationFit.score * 100)}/100)`,
      ...(digest ? [digestText(digest)] : []),
      neutralise(descriptionExcerpt(j.description, digest ? digestExcerptChars : excerptChars)),
      `</job>`,
    ].join("\n");
  });
  return `<candidate>\n${profileForScoring(profile)}\n</candidate>\n\n${blocks.join("\n\n")}`;
}
