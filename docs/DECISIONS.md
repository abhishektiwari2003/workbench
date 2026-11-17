# Engineering Decisions

> Maintained by Claude during the build. Every significant decision is recorded as a question with a short, clear answer (under 30 seconds).

## 1. Problem

**Problem statement (verbatim):**

> **CoCareer · Live build: Job matching app.** A job seeker uploads their resume and only wants to see jobs that are a strong match for them. Your app finds and analyzes those jobs from the 10 boards below. What they see from that point on is up to you.
>
> **Must have:** From resume upload to matches, working end to end. Jobs from all 10 boards. An LLM explaining why each job is a match, keeping cost low without hurting match quality. Be ready to tell us roughly what it costs per candidate. No saved data needed. Keeping everything in memory is fine.
>
> **If you have time:** Letting the client come back anytime and see their matches. A refresh you can run on a schedule that picks up new and closed jobs. A check of whether the matching is any good.
>
> **Boards:** Greenhouse `https://boards-api.greenhouse.io/v1/boards/<board>/jobs?content=true` (stripe, databricks, airbnb, duolingo, discord). Ashby `https://api.ashbyhq.com/posting-api/job-board/<board>` (openai, ramp, notion, supabase, linear). Public, no key, each call returns a company's full list of open jobs.
>
> **Judged on:** product and design, code you own, judgment (cost vs match quality), how you work with AI, system thinking.

**Restated in one paragraph:**
A job seeker gives us their resume (PDF, text, or paste). We pull every open role from 10 company boards (about 3,300 jobs), find the handful that are genuinely strong matches, and show only those, each with a short, evidence-based explanation of why it fits and what the gap is. The hard part is doing that cheaply: we can't send 3,300 job descriptions to an LLM per candidate, so the design is a funnel: cheap deterministic filtering first, expensive LLM judgement only on the few jobs that could plausibly match.

**Assumptions made:**
- "Strong match" = AI score 75+ out of 100. I show 60-74 as collapsed "near misses" so an empty result still gives the user something to act on.
- Resumes are PDF or plain text. DOCX and scanned PDFs are out of scope: the user gets a clear message to paste the text instead.
- Location is a soft signal, not a hard filter: the candidate may relocate, and the LLM sees the location and can call it out as a gap.
- One candidate = one search. "Come back anytime" is a link (and localStorage) to the saved result, not an account.
- Job data can be up to 30 minutes stale; the scheduled refresh endpoint makes it fresher.

**Open questions to confirm with stakeholders:**
- Is a missed strong match (false negative) worse than showing a mediocre one (false positive)? That sets the shortlist size and score threshold, which are the main cost dials.
- Should hard constraints (visa, location, salary floor) be explicit user inputs instead of inferred from the resume?
- Should returning users get re-scored automatically when new jobs appear (costs money per user per refresh), or only on request?

**Acceptance criteria:**
- [x] Upload a PDF/TXT or paste a resume and get scored matches back end to end (verified with curl: PDF, TXT and paste; the UI renders server-side. A full in-browser click-through is still to do before the demo).
- [x] Jobs come from all 10 boards (3,269 jobs at build time); one board failing doesn't break the search.
- [x] Every shown job has 1-3 LLM reasons citing resume evidence, plus its main gap; only 75+ scores are shown as matches.
- [x] Each result reports what it cost (measured: ~$0.06 per candidate, $0 for a repeat of the same resume).
- [x] Bad input (empty, too long, wrong type, malformed JSON, bad file, not a resume) gets a clear 400/413/415/422 message; LLM failure gets a friendly retryable message (re-verified after review with curl, including chunked oversized bodies).
- [x] Returning via the saved link shows the same matches and flags roles that have since closed (checked against a fresh snapshot); "Check for new jobs" re-runs the saved resume instead of discarding the result; the refresh endpoint reports added and closed jobs.

## 2. Architecture

```
Browser (one client component: upload/paste form + results)
   |  POST /api/resume (multipart)     -> unpdf text extraction (no LLM)
   |  POST /api/match {resumeText}     -> lib/matcher.ts
   |  GET  /api/matches/:id            -> lib/store.ts (saved result + closed-job flags)
   |  GET  /api/jobs, POST /api/jobs/refresh -> lib/boards.ts
   v
lib/matcher.ts
   |-- in parallel --> generateJSON(fast/Haiku): resume -> compact profile      ~$0.0005
   |               \-> lib/boards.ts: 10 boards -> normalised Job[] (30-min shared cache, single-flight)
   |-- lib/prefilter.ts: score all ~3,300 jobs in plain code (title, skills, level, location) -> top 20   $0
   |-- 4 x generateJSON(smart/Sonnet) in parallel, 5 jobs each: score 0-100 + reasons + gaps          ~$0.056
   v
MatchResult (score >= 75 matches, 60-74 near misses, cost, stats) -> in-memory store -> UI
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js App Router, one client component, Tailwind | One deployable app; server-rendered shell, only the form is interactive |
| API | Next.js route handlers + `lib/api.ts`, `lib/rate-limit.ts`, zod | Same app, no CORS; one error shape; validated input |
| Data | In-memory: job snapshot (30-min TTL) and saved results (7-day TTL, 1,000 cap) | Brief says no persistence needed; interfaces are drop-in for Redis/Postgres |
| LLM | Haiku for profile extraction, Sonnet for scoring, both at `effort: low`, via `lib/llm.ts` | Cheap model for extraction, better judgement where quality is visible; low effort keeps billed thinking tokens down |
| PDF | `unpdf` | Serverless-friendly PDF text extraction, no native deps |

**Data model:**

```ts
type Job = { id: string /* "gh:stripe:123" */; company; title; location; remote: boolean; department; url; postedAt?; description /* plain text, ≤6k chars */ };
type Profile = { isResume: boolean; headline; seniority: "intern"|...|"director"; yearsExperience; targetTitles[]; skills[] /* kept only if found in the resume */; domains[]; locations[]; openToRemote; highlights[] };
type ScoredJob = { job: JobSummary; score: number; reasons: string[]; gaps: string[] };
type MatchResult = { id; createdAt; profile; stats: { jobsScanned; boards: BoardStatus[]; analysed; unscored /* shortlisted but not scored */; ms }; matches: ScoredJob[]; nearMisses: ScoredJob[]; cost: { usd; calls; inputTokens; outputTokens } };
```

**API contract:**

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|
| POST | /api/resume | multipart `file` (PDF/TXT/MD, ≤5 MB, ≤20 pages) | `{data:{text, truncated}}` | 400 empty/invalid form, 413 too large (counted while streaming), 415 type, 422 unreadable/no text/too many pages, 429 |
| POST | /api/match | `{resumeText}` 200-30,000 chars, ≥20 distinct words; unknown fields stripped | `200 {data: MatchResult}` | 400 invalid_json / validation_error (field-level), 413 too_large, 422 not_a_resume, 429, 502 llm_parse/llm_api, 503 llm_overloaded / boards_unavailable / busy, 504 llm_timeout |
| GET | /api/matches/:id | uuid | `{data: MatchResult & {closedJobIds, closedChecked}}`, `Cache-Control: private, no-store` | 400 invalid_id, 404 expired, 429 |
| GET | /api/jobs | n/a | `{data:{total, boards, fetchedAt}}` | 429, 503 boards_unavailable |
| POST | /api/jobs/refresh | `Authorization: Bearer $CRON_SECRET` (required in production) | `{data:{total, added, closed, boards, fetchedAt}}` | 401, 429, 503 not_configured / boards_unavailable |

Every 429 carries a `Retry-After` header. `POST /api/match` returns 200, not 201: the result is a read-only snapshot and the client gets its id in the body; a `Location` header adds nothing for a one-page client.

## 3. Design Q&A

_Format: question, then the answer exactly as I would say it._

**Q: Why did you choose this stack?**
A: One Next.js app with API routes, TypeScript and zod. It's the fastest thing to build and demo, there's one deploy, and the server and client share types. Nothing here needed Python.

**Q: Why this data model?**
A: I normalise both Greenhouse and Ashby into one small `Job` type at the edge, so the rest of the app never knows which board a job came from. IDs are prefixed with the board and company so they're unique. I strip HTML once at ingest and cap descriptions at 6k characters, so memory stays small and every downstream step works on plain text.

**Q: How do you keep cost low without hurting match quality?**
A: It's a funnel. Haiku turns the resume into a compact profile, for less than a tenth of a cent. Then plain code scores all 3,300 jobs on title overlap, skills, seniority and location in about 70 milliseconds of CPU, for free, and keeps the top 20. Only those 20 go to Sonnet, five per call, four calls in parallel, and each job is trimmed to the requirements section. Sonnet is where quality is visible to the user, so that's where I spend.

**Q: What does it cost per candidate?**
A: I measure it on every request, and it's shown in the UI. About 6 cents: roughly 15k input tokens and 3.5k output tokens, almost all of it the four Sonnet calls. Running the same resume again costs zero because of the response cache. At 100k candidates a month that's about $6k, and SCALE.md shows how job digests cut that roughly in half.

**Q: Why two models for scoring?**
A: Haiku is twenty times cheaper than Sonnet, so it scores all 40 shortlisted jobs with sub-scores for skills, seniority and domain. Sonnet then explains and re-scores only the best ten, which are the cards a user actually reads. That doubled the jobs we judge and cut cost from 6 cents to about 3.4 cents per candidate. The quality panel checks that the cheap stage isn't throwing good jobs away.

**Q: How do you make sure the user never sees an empty page?**
A: Strong is 70 and up, Good is 55 to 69, and Strong always comes first. If nothing reaches 55, we still explain the top three and label them "Closest available", with honest gaps. Only a resume that shares no title or skill with any of the 3,300 jobs gets an empty result, and it gets an explanation instead.

**Q: How is location handled for someone in India?**
A: Every job is normalised to countries and regions in code. Ashby gives a structured workplace type, which we trust; its `isRemote` flag is true for hybrid roles, so we ignore that one. Greenhouse has no workplace field, so we only say remote or hybrid when the posting says so and never guess on-site. Then a deterministic location fit ranks same-country and remote-anywhere roles above on-site roles abroad, and the models see that verdict instead of guessing geography.

**Q: Why not just embed everything and do vector search?**
A: It would work, but for 3,300 jobs keyword and title scoring is free, instant and explainable, and it got good shortlists in testing. Embeddings are the next step when the job pool grows to hundreds of thousands, or if prefilter recall turns out weak.

**Q: How does this handle 10x and 100x more users?**
A: Job fetching is shared, not per user: one snapshot serves everyone, refreshed on a schedule. So user growth only scales the LLM calls. Those are capped by the concurrency limit and per-IP rate limits, and repeat resumes are free. At scale I'd move the snapshot and results to Redis and Postgres, and run scoring through a queue. Details are in SCALE.md section 7.

**Q: What happens when the Claude API is slow, down or returns bad output?**
A: `lib/llm.ts` has a timeout, SDK retries and one schema-repair retry, and a cut-off reply gets a bigger token budget on the retry. The whole pipeline has a 45-second deadline, so the user gets a clean "took too long, retry" instead of a hang, and the wait queue is capped so a burst fails fast instead of piling up. The four scoring batches are independent: if one fails, the user still gets the others, and the result says how many roles couldn't be reviewed instead of hiding it. If all fail, the user sees "Our AI matcher is busy, your resume is fine" with a Retry button. Ids the model invents are dropped, and duplicates are ignored.

**Q: What if a job board is down?**
A: Boards are fetched with `Promise.allSettled` and a 20-second timeout each. A failed board keeps its last good jobs, marked stale, and the UI says which company couldn't be reached. The search only fails if all 10 are down.

**Q: How do you protect against prompt injection and bad input?**
A: Every input is validated with zod for length and type, and bodies are capped while they stream in, so a chunked upload can't skip the limit. Uploads are checked by magic bytes, not file extension, capped at 5 MB and 20 pages. The resume and job text go inside data tags, and I neutralise any closing tag inside them, so a job posting can't break out and tell the scorer what to do. Model output is validated against a schema, and React renders it as plain text, never HTML. Job links come from the board APIs, must be https, and never come from the model. Error responses send a fixed message per error type; the details stay in server logs.

**Q: Which model did you use, and why?**
A: Haiku 5.5 for extraction: it's structured and cheap at $0.10 per million input tokens. Sonnet 5.5 for scoring with reasons, because judging fit and explaining it is where users notice quality. Both run at low effort, because thinking tokens bill as output and this task doesn't need deep reasoning. I didn't use Opus: it would cost twice as much as Sonnet with no visible gain here.

**Q: How does "come back anytime" work?**
A: Every result gets an id that's saved in the URL hash and in localStorage, and the resume text stays in this browser's localStorage too. When the user returns, the page loads the saved result instead of re-running it, at zero cost. It checks each matched job against the current job snapshot and marks the ones that have closed. "Check for new jobs" re-runs the saved resume; unchanged jobs hit the response cache. If the link was opened on another device, it asks for the resume and keeps the saved matches on screen. A network blip never deletes the saved link; only a 404 does.

**Q: How do you know the matching is any good?**
A: Right now I spot-check it. A backend payments resume gets Stripe, Ramp and OpenAI backend roles at 77-92, and a Madrid data engineer correctly gets very few matches, because the 10 boards have almost no data-engineering roles in Europe. The next step is a small labelled eval: 10 resumes, with a human grading the top 20 for each, to measure prefilter recall and score agreement.

**Q: Two identical searches arrive at once. What happens?**
A: They share one run. `runMatch` is single-flight on a hash of the resume, so a double click, two tabs or a retry after a refresh attach to the run already in progress and get the same result id, and the second one costs nothing. I chose that over cancelling the run when the client disconnects, because the two conflict: with a shared run, one caller leaving shouldn't kill the other's result. A finished run also fills the response cache, so retrying later is free.

**Q: What if someone pastes something that isn't a resume?**
A: Two gates. A free one first: under 20 distinct words is rejected before any model call, which catches padding like "aaaa". Then Haiku's profile has an `isResume` flag, so a pasted job posting or essay stops with a clear 422 before the expensive Sonnet calls. Without the flag the schema forced Haiku to invent a profile.

**Q: How do you stop the model inventing skills?**
A: After Haiku extracts the profile, plain code keeps only the skills that actually appear in the resume text. An invented skill can't steer the shortlist or show up as a reason. If none match verbatim, for example a translated resume, I keep the model's list rather than none.

**Q: Why does the refresh endpoint refuse to run without a secret?**
A: It's an expensive fan-out to ten third-party APIs, so it fails closed. In production it returns 503 until `CRON_SECRET` is set, and the token is compared in constant time. It's open only in local dev, so the demo works.

**Q: Rate limits can be dodged by faking the IP header. What did you do?**
A: The key now comes from the platform's IP header, or the last forwarded hop, never the client-controlled first one. Because headers can still be faked on some setups, `/api/match` also has a per-instance global ceiling of 60 a minute. That puts a hard cap on LLM spend whatever the IP says. In production both move to Redis.

**Q: Why not score with Haiku to save money?**
A: Haiku costs about a twentieth of Sonnet, so it's the obvious lever. But the reasons are what users read, and I won't trade them away without measuring. The plan is two-stage: Haiku scores all 20, and Sonnet writes reasons only for the ones scoring 65 or more. I'd ship that once the 10-resume eval shows it doesn't lose strong matches.

**Q: What did you deliberately leave out, and why?**
A: Accounts, a database, DOCX/OCR parsing, a feedback loop and email alerts for new matches. None of them are needed to prove the core loop, and each one is a clear next step.

## 4. How I Built It

**Workflow:** one kickoff prompt builds the core flow end to end with Claude Code, then 12 specialist review agents check the build in parallel (correctness, error handling, API design, data model, scalability, security, edge cases, LLM usage, UI/UX, accessibility, maintainability, test coverage). A resolver agent on Opus then validates every finding, merges duplicates, fixes them by root cause in one verified pass, and records the rest as documented tradeoffs.

**Build log:**

| Step | What was built | Notes |
|---|---|---|
| 0 | Fetched all 10 boards with curl before writing code | 3,269 jobs, 41 MB raw; confirmed Greenhouse double-encodes HTML and Ashby has `descriptionPlain`, `isRemote`, `isListed` |
| 1 | Scaffold Next.js beside the kit and merge | macOS `cp -n` exits 1 when it skips files, which stopped the chained commands; I ran the rest by hand. Disabled Next's auto-generated AGENTS.md (`agentRules: false`) |
| 2 | Extended `lib/llm.ts` with `effort` and `onUsage` | Haiku 5.5 and Sonnet 5.5 think by default and thinking bills as output; `onUsage` lets every result report real cost |
| 3 | `lib/boards.ts`, `lib/text.ts`, `lib/prefilter.ts` | Shared snapshot with single-flight load; zod-validated external payloads |
| 4 | `lib/matcher.ts`, `lib/prompts.ts`, `lib/cost.ts`, `lib/store.ts`, `lib/resume.ts` | First end-to-end run: 10.3s, $0.057, sensible matches |
| 5 | API routes | Removed `export const runtime = "nodejs"`: Next 16 rejects it with `cacheComponents`, and Node is already the default |
| 6 | UI: upload/paste form, skeleton, results, near misses, saved-result banner | |
| 7 | curl edge cases | Fixed: wrong-type field said "required"; rate limit of 5/min was hit in my own testing, raised to 10/min |
| 8 | Scorer grounding | Prompt now says to use only the given job text and to return `[]` when there's no real gap; re-verified: no invented stack claims, $0.060 per run |
| 9 | Docs | DECISIONS and SCALE §7 filled with measured numbers |
| 10 | Review: saved-result flow | "Check for new jobs" re-runs the resume kept on this device instead of deleting the link. Restore never overwrites a newer search, and keeps the link on transient errors. The closed-role check uses a fresh snapshot |
| 11 | Review: typed errors | `AppError` in `lib/api.ts`; boards-down is a typed 503 on every route; LLM errors return fixed messages; `api` kind maps to 502 |
| 12 | Review: bounded LLM work | 45s pipeline deadline passed as an abort signal; LLM queue capped at 100; truncated replies retry with 1.5x tokens; single-flight per resume hash (verified: two concurrent identical requests → one run, same id, $0.058) |
| 13 | Review: input gates | Body cap counted while streaming (chunked 300 KB JSON and 6 MB upload → 413); PDF page cap; distinct-word check (25k × "a" → 400); `isResume` flag (pasted job posting → 422, no Sonnet spend) |
| 14 | Review: abuse | Refresh fails closed in production with a constant-time token check; rate-limit key from the trusted hop, map swept, `Retry-After` header, limits in one table, global 60/min match ceiling |
| 15 | Review: match quality | Manager-level bug fixed (diff 1.5 scored as 0.1); skills grounded in the resume; partial scoring reported as `stats.unscored`; prompt tags neutralised; board URLs must be https |
| 16 | Review: performance | Skill regexes compiled once per request; lowercased job text cached per snapshot; snapshot served stale-while-revalidate. Measured prefilter: ~70ms on real data (the docs had said 10ms) |
| 17 | Review: UI and accessibility | Skeleton replaces the stale result during a re-run; scroll to results on submit; 700-shade score text; closed roles get a badge and strike-through instead of opacity; upload status in a live region; sr-only score text; header moved out of `<main>`; errors announced once; copy built from shared constants |
| 18 | Upgrade phase 1: two-stage pipeline | Haiku scores a 40-job shortlist (4×10) with skill/seniority/domain sub-scores; Sonnet explains and re-scores the best ≤10 (2×5). Measured $0.034/candidate (was $0.06) with twice the jobs judged. Tiers: Strong ≥70, Good 55–69, honest "Closest" when nothing qualifies |
| 19 | Upgrade phase 1: honest cost | Response-cache entries keep their original usage; whole results cached per resume + job snapshot + feedback state. Every result shows "Cost to compute" and, on a hit, "Served from cache · $0 spent" (verified: repeat in 15ms, $0.0364 compute, $0 spent) |
| 20 | Upgrade phase 1: location | `lib/location.ts` normalises locations to countries/regions. Workplace comes from Ashby's structured `workplaceType` (its `isRemote` is true even for Hybrid, so the old "Remote friendly" label was wrong). Greenhouse has no such field, so we never guess "On-site". India test resume: every match India-based or remote-anywhere |
| 21 | Upgrade phase 1: profile + boards | `country` added; target titles checked against years of experience in code (no Staff titles under 8 years). Board failures shown per board; verified with `SIMULATE_BOARD_FAILURE=linear` (9 boards matched, Linear listed as missing). Duplicate re-posts (same company + title) collapsed before scoring |

**Where the AI got it wrong and how it was caught:**
- The scaffold commands assumed `cp -n` exits 0. I caught it because the build listing still showed `scaffold-tmp` and AGENTS.md, and the package name hadn't changed.
- It added `export const runtime = "nodejs"` per the template, which breaks under Next 16 `cacheComponents`. I caught it from the dev-server log on the first curl.
- The zod "required" message also fired for wrong types. I caught it by sending `{"resumeText":123}` in the edge-case pass.
- The scorer stated an outside "fact" in a gap ("Stripe's stack is mostly Java/Ruby", which wasn't in the text it was given). I caught it by reading the reasons on the first real run, not just checking that it returned 200. The fix tightened the prompt; the next run then padded with a filler gap, so I also allowed `[]` for gaps. Both were verified on a real run.
- In review, 12 agents found that "Check for new jobs" deleted the saved result after a reload, and that a plain "Engineering Manager" title scored as the wrong level for manager candidates. Neither shows up in a happy-path curl test. Both were fixed and re-verified.
- The docs claimed the prefilter took 10ms. I measured about 70ms on real board data and corrected the docs instead of keeping the nicer number.

## 5. Edge Cases Handled

| Case | Behaviour |
|---|---|
| Empty / whitespace / <200 chars | Client blocks with message; server 400 field error |
| >30,000 chars | Live counter turns red; server 400 |
| Malformed JSON / missing / wrong-typed field | 400 `invalid_json` / `validation_error` with field message |
| Empty, oversized, non-PDF/TXT, corrupt or scanned PDF | 400 / 413 / 415 / 422 with a human sentence suggesting paste |
| Non-English resume, emoji | Profile is written in English; tokenizer is Unicode-aware (tested with Spanish) |
| One board down or slow (20s timeout) | Uses last good jobs (marked stale) and the UI names the board; all down → 503 |
| LLM slow / rate-limited / bad JSON / invented ids | Timeout + retries + schema repair; partial batches survive; friendly retry message |
| Double submit / two tabs / stale response | Button disabled while pending; new submit aborts the old fetch; identical concurrent resumes share one server run and one id |
| Not a resume (padding, job posting, essay) | <20 distinct words → 400 before any LLM call; Haiku `isResume: false` → 422 before Sonnet |
| Oversized or chunked body | Capped while streaming: JSON 200 KB → 413, upload 5 MB → 413; PDFs over 20 pages → 422 |
| LLM hangs or queue floods | 45s pipeline deadline → 504 with retry; queue over 100 → 503 overloaded |
| Some scoring batches fail | Result shows "N of the closest roles couldn't be reviewed, run again" |
| Re-running while results are shown | Skeleton replaces the old result (no stale links to click); old result returns if the new run fails |
| Abuse | Per-IP limits (match 10/min, upload 20/min, refresh 2/min) with `Retry-After`; global match ceiling 60/min per instance; refresh needs `CRON_SECRET` in production |
| Saved link expired / bogus id | 404/400 forget the link silently; a network error or 429 keeps it and offers Retry |
| "Check for new jobs" after a reload | Re-runs the resume saved on this device; on another device asks for the resume and keeps matches visible |
| Matched job closed since | "Closed since your search" badge, struck-through title, no apply link |
| Accessibility | Labelled inputs, aria-live announcements, visible focus rings, Cmd/Ctrl+Enter |

## 6. Review Findings

**Fixed:**

| Agent | Issue | Fix |
|---|---|---|
| correctness, ui-ux | "Check for new jobs" deleted the saved id and matches after a reload (textarea empty) | Resume text saved with the id in localStorage and restored; rerun never clears the link; on another device it asks for the resume and keeps matches visible |
| correctness, error-handling | Restore raced a new submit, and any failure (blip, 429) deleted the saved link | Restore skipped once a submit starts; only 404/400 forget the id (and only if it's still the current id); other failures show Retry |
| correctness | Manager rank 3.5 gave diff 1.5, which fell to 0.1; plain "Engineering Manager" titles ranked as mid | Band comparison (`<=1`, `<=2`); manager-track titles default to manager rank |
| correctness, error-handling, api-design | Closed-role check used a possibly stale `peekJobs()`; no try/catch; no Cache-Control | `getJobs()` with peek fallback, `closedChecked` flag, try/catch + handleError, `Cache-Control: private, no-store`; 200 vs 201 documented, 413 added to contract |
| correctness, error-handling, llm-usage | Failed batches and skipped ids vanished silently | `score_batch_failed` log line; `stats.unscored`; UI note "N couldn't be reviewed, run again" |
| correctness, error-handling ×2, api-design, maintainability, test-coverage | Boards-down detected by string compare; `/api/jobs` and refresh returned 500; LLM `api` errors returned 500 | `AppError` class in `lib/api.ts` mapped by `handleError` (503 `boards_unavailable` on every route); `api` → 502 |
| correctness, scalability | A new RegExp per job × skill; lowercasing about 20 MB per request | Regexes compiled once per request; lowercased text cached per job (WeakMap). Docs corrected to the measured ~70ms |
| error-handling, scalability, llm-usage | No overall deadline; unbounded `withSlot` queue | 45s `AbortSignal.timeout` through `generateJSON` to the SDK and the queue; queue capped at 100 (fails fast as overloaded); `maxDuration = 60` on the route |
| error-handling, api-design ×2, security ×2, scalability, edge-case | `req.text()` / `formData()` buffered everything before the size check; chars vs bytes; Content-Length trusted; unbounded PDF pages | `readBodyCapped` counts bytes while streaming (both routes), try/catch → 400 `invalid_body`; PDF page cap of 20 |
| api-design, security, edge-case | Refresh open when `CRON_SECRET` unset; `!==` compare | 503 `not_configured` in production without the secret; sha256 + `timingSafeEqual` |
| api-design, edge-case ×2 | Concurrent identical POSTs ran two paid pipelines with two ids | Single-flight per resume hash in `runMatch` (verified: one run, same id) |
| scalability, security, edge-case | Leftmost XFF trusted (spoofable); limiter map never pruned; no global cap | `x-real-ip` or the rightmost XFF hop; sweep at 10k keys; global 60/min per instance on `/api/match` |
| api-design, maintainability | No `Retry-After`; limit block and numbers duplicated in 5 routes | `limitOr429` helper sets `Retry-After`; `LIMITS` table in `lib/rate-limit.ts` |
| edge-case, llm-usage | Non-resumes ran a full paid search; the schema forced an invented profile | Distinct-word refine (400, free); `isResume` in profile → 422 `not_a_resume` before Sonnet |
| llm-usage | Haiku skills never checked against the resume | Skills kept only if `containsTerm` finds them in the resume (falls back for translated resumes). Highlights not yet grounded (see tradeoffs) |
| llm-usage | Prompt-caching claim false (prompts below the minimum prefix) | Comments in `prompts.ts` and `llm.ts` corrected; cost story rests on the response cache |
| security, llm-usage | `</job>` / `</user_input>` in board or resume text could break out of data tags | Closing and opening tags neutralised in `generateJSON` input and in every job/profile field; board ids restricted to `[\w-]` |
| security | Board URLs accepted as any string and rendered as href | `https://` only, no whitespace or quotes, at ingest (all 3,270 jobs still pass) |
| security | `handleError` returned LLM internals (zod paths, "API key not set") | Fixed message per error kind; detail logged as `llm_error` |
| llm-usage | Retry after `max_tokens` used the same budget | Retry uses 1.5x `maxTokens` |
| ui-ux | Results rendered off-screen below the form on mobile | Results container scrolls into view on submit (instant if reduced motion is set) |
| ui-ux, accessibility | Re-run only dimmed the old result (opacity-60) | Skeleton replaces the stale result while pending; `aria-busy` on the container |
| accessibility, ui-ux | Score and notice text below 4.5:1 (emerald/amber-600) | Text moved to 700 shades; spec hues kept |
| accessibility | Closed role signalled by opacity-60 on the whole card | Full opacity; zinc "Closed since your search" badge; struck-through title |
| accessibility | Upload progress, success and errors not announced | Persistent `aria-live="polite"` status line, including "Reading your file..." |
| accessibility | `aria-label` on a generic div for the score | sr-only "Match score … out of 100" text |
| accessibility | Header inside `<main>`; errors announced twice | Header moved above `<main>`; errors announced only by `role="alert"` |
| maintainability ×2 | UI hardcoded 75/60/20/30,000/5 MB; duplicate file limit; literal 200 in resume.ts | `SHORTLIST_SIZE`, `MAX_FILE_BYTES` in `lib/schemas.ts`; UI and `resume.ts` use the constants |
| api-design | Unknown fields silently stripped without intent | Documented as intended (forward-compatible clients) in code and contract |
| scalability | Requests stalled on a full board refetch every 30 min | Stale-while-revalidate in `getJobs()`; background refresh is single-flight |

**Known tradeoffs (talking points, not fixed):**

| Agent | Issue | What I'd do with more time |
|---|---|---|
| data-model ×6, scalability | Results, job snapshot and refresh diffs live in per-process memory; FIFO cap of 1,000; no job table, resume hash, model/prompt version or delete route | The brief allows in-memory. Next step: the Prisma `Job`/`Candidate`/`Match` schema from the data-model review (soft-closed jobs, `resumeHash`, `promptVersion`, `expiresAt` cleanup, delete-my-data), with Redis for hot reads (SCALE.md §7) |
| scalability | LLM response cache is per-process (500 entries, 10 min), so repeat-is-free only holds on one instance | Redis with the same sha256 key, plus `profile:` and `score:<profile>:<job>:<content_hash>` caches |
| scalability, llm-usage | Pipeline runs inside the HTTP request; client disconnect doesn't cancel the run | Deliberate for now: single-flight conflicts with abort-on-disconnect, and a finished run fills the cache so a retry is free. At scale: 202 + queue + polling (SCALE.md §7) |
| scalability | Each instance fetches boards itself; `/api/jobs/refresh` updates one instance | Cron worker publishes a versioned snapshot to Redis/S3 |
| llm-usage | Sonnet scores all 20 jobs (~98% of cost) | Two-stage scoring (Haiku scores, Sonnet explains ≥65), gated on the 10-resume eval |
| llm-usage | Highlights not grounded; no `server-only` guard | Near-verbatim highlights with a numbers check; `server-only` needs a new dependency, so it's left as a comment rule |
| correctness | Country-only profile locations ("USA") never match city job locations (0.6 penalty) | Country/region alias table, or treat unparseable locations as unknown (1.0) |
| test-coverage ×5 | No test runner or tests | Add vitest (new dependency, out of scope for the live build): `generateJSON` repair path, `scoreShortlist` partial failure, `shortlist` fixture, route 400s, board fallback |
| maintainability | `lib/llm.ts` is 262 lines (kit helper, extended); two TTL caches | Split the cache/limiter and error mapping into their own modules; one shared TTL map |
| maintainability | Prefilter weights and cutoffs unnamed; level words listed twice | Name them alongside the eval that will tune them |
| ui-ux ×4 | Busy hero card; near misses as nested cards; long cards; four controls on the input card | Profile in a `<details>`, compact near-miss rows, 2 reasons + 1 gap, quieter "Try an example" |
| ui-ux | "One accent" for score badges | Not changed: the kickoff spec defines emerald/amber/rose score colours. Contrast fixed |
| edge-case | 405 responses have an empty body | Explicit 405 handlers with the JSON error shape and `Allow` |
| edge-case | `[]`/`null` body gives a technical zod message | Acceptable (400 with field); could map to "Send a JSON object with resumeText" |
| security | Saved links are 7-day bearer URLs with profile data | UUIDv4 in the URL hash (never sent in Referer); bind to a cookie if sharing isn't wanted |
| error-handling | Board load has no retry when no cache exists; upload error has no retry button | Retry the board load once; add a "Try again" next to the upload error (the message already suggests pasting) |
| edge-case (2 rows) | Whitespace padding and bad ids/uploads | False positives: reviewer confirmed correct behaviour, no change needed |

## 7. Demo Script

1. **Setup:** `npm run dev`, open http://localhost:3000 (the page warms the job cache on load).
2. **Happy path:** click "Try an example", then "Find my matches". Point at: the page scrolls to the skeleton instantly; about 10-12 seconds later the hero shows the number of strong matches (5 in the last run), with "From 3,270 open roles at 10 companies · 20 closest reviewed by AI · AI cost $0.058". Open the top card (Stripe, 90): reasons cite the resume ($2B/month ledger), and there's one honest gap.
3. **Cost story:** run it again. It comes back in about 0.2s at $0.000 (response cache). Then explain the funnel: 3,270 jobs → 20 → 4 Sonnet calls. Mention that a double click or two tabs share one run (single-flight).
4. **Edge case to show:** paste the Spanish data-engineer resume. The profile is still read correctly, and the app honestly shows few strong matches plus near misses, instead of padding the list.
5. **Come back anytime:** reload the page. Saved matches return at no cost and the resume is back in the textarea. Click "Check for new jobs": it re-runs, and unchanged jobs come from the cache. Mention `POST /api/jobs/refresh` for the scheduler (needs `CRON_SECRET` in production), and closed roles getting a "Closed since your search" badge.
6. **Error handling to show:** upload a .gif (clear 415 message), clear the textarea and submit (inline validation), or paste a job posting instead of a resume ("That doesn't look like a resume", no Sonnet spend).
7. **Code to point at:** `lib/matcher.ts` (the whole pipeline in about 100 lines), `lib/prefilter.ts` (free ranking), `lib/prompts.ts` (static prompts, compact inputs), `lib/cost.ts`.

**60-second walkthrough:**
"You upload a resume. Haiku turns it into a small profile for a tenth of a cent. Meanwhile one shared snapshot of all 10 boards, about 3,300 jobs, is already in memory. Plain code ranks every job on title, skills, level and location for free, and only the top 20 go to Sonnet, in four parallel calls of five. Sonnet scores each job strictly, with reasons and gaps, using only the job text it was given. We show only 75 and up. It takes about 10 seconds and costs about 6 cents a candidate, and a repeat is free. Results get a link, so you can come back, and closed roles get flagged."

## 8. What I'd Do Next

1. **Eval:** 10 labelled resumes with the top 30 jobs graded by a human. Measure prefilter recall@20 and score agreement, then tune `SHORTLIST_SIZE` and the threshold with data instead of gut feel.
2. **Precompute job digests at ingest:** a Haiku or Batch API pass extracts each job's must-haves once per refresh, shared by every candidate. That shrinks scoring input around 3x and enables a cheaper first-pass rerank.
3. **Alerts for returning users:** after each scheduled refresh, run only the *new* jobs through prefilter for saved profiles, and score just those.
4. Score stability: scores near the 75 cutoff move a few points between runs. The eval should measure this; I may average two cheap runs or widen the near-miss band.
5. DOCX/OCR support, explicit hard filters (location, visa), and thumbs up/down feedback on matches to feed the eval.
