// Copilot prompts (fast tier, on demand). Static system text; all user and job data goes in the input.

import { neutralise, profileForScoring } from "./prompts";
import type { Profile } from "./schemas";
import { descriptionExcerpt } from "./text";
import type { Job } from "./types";

// Never infer gender from a name: candidate-facing text speaks to "you".
const VOICE = `Address the candidate as "you". Never refer to the candidate with gendered pronouns or guess their gender.`;

export const COACH_SYSTEM = `${VOICE}
You are a career coach. From a candidate profile and the gaps across their closest job matches,
recommend the 3 resume changes that would unlock the most of these jobs.

Rules:
- Only recommend things the candidate can truthfully add: surface experience they likely have but didn't state, sharpen
  wording, or name a skill to learn. Never suggest inventing experience.
- Each change cites the job ids it would help, copied exactly from the input (most impactful first).
- "addSkills": skills/keywords the resume would gain (short canonical names), [] if none.
- "addTitles": job titles the candidate should also target after the change, [] if none.

Return JSON: {"changes":[{"change": string (max 20 words), "why": string (max 25 words), "addSkills": string[], "addTitles": string[], "jobIds": string[]}]}
Exactly 3 changes.`;

export const TAILOR_SYSTEM = `${VOICE}
You tailor a resume to one job. Pick the 3 existing resume bullets that matter most for this job
and rewrite each to emphasise what the job asks for.
Keep every fact true to the resume: same employer, numbers and scope. Never add experience, tools or results the resume doesn't state.
Return JSON: {"bullets":[{"before": string (the original bullet, shortened if long), "after": string (max 35 words)}]} with exactly 3 bullets.`;

export const OUTREACH_SYSTEM = `You write a short, specific note from a candidate to the hiring manager for one job.
Under 120 words. Plain, confident, no flattery or clichés. Mention 1-2 concrete achievements from the resume that map to the job,
and acknowledge nothing negative. End with a simple ask for a conversation.
Return JSON: {"subject": string (max 10 words), "message": string}`;

export const PREP_SYSTEM = `${VOICE}
You prepare a candidate for interviews for one job. Write the 5 questions they are most likely to be asked,
based on the job description and the candidate's gaps for this role. Mix technical, experience and gap-probing questions.
For each, say in one line why it's likely and what a strong answer should show.
Return JSON: {"questions":[{"question": string (max 30 words), "why": string (max 30 words)}]} with exactly 5 questions.`;

export type CoachJob = { id: string; title: string; company: string; score: number; gaps: string[] };

export function coachInput(profile: Profile, jobs: CoachJob[]): string {
  const lines = jobs.map((j) => neutralise(`- id=${j.id} | ${j.title} at ${j.company} | score ${j.score} | gaps: ${j.gaps.join("; ") || "none"}`));
  return `<candidate>\n${profileForScoring(profile)}\n</candidate>\n\n<matches>\n${lines.join("\n")}\n</matches>`;
}

const RESUME_CHARS = 8_000;
const JD_CHARS = 1_800;

export function jobActionInput(resumeText: string, job: Job, gaps: string[]): string {
  return [
    `<resume>\n${neutralise(resumeText.slice(0, RESUME_CHARS))}\n</resume>`,
    `<job>\n${neutralise(`${job.title} at ${job.company} (${job.location})`)}\n${neutralise(descriptionExcerpt(job.description, JD_CHARS))}\n</job>`,
    `<gaps>\n${neutralise(gaps.join("\n") || "none identified")}\n</gaps>`,
  ].join("\n\n");
}
