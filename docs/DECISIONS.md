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
- Tiers: **Strong** = final score 70+, **Good** = 55–69, Strong shown first. If nothing reaches 55, the best 3 are shown honestly as **Closest available**, so a reasonable resume never gets an empty page.
- Resumes are PDF or plain text. DOCX and scanned PDFs get a clear "paste the text instead" message.
- Location is a strong but soft signal. Same-country and remote-anywhere roles rank above on-site roles abroad; the models see a deterministic location verdict instead of guessing geography.
- Workplace labels come from the board's structured field when it has one (Ashby `workplaceType`). Greenhouse has none, so a Greenhouse role is only called remote or hybrid when the posting says so; otherwise we show the place and never guess "On-site".
- Accounts (Clerk) hold history, feedback and a daily quota of 5 new searches. Repeating a search is free. Everything is in memory, as the brief allows.
- Job data can be up to 30 minutes stale; `POST /api/refresh` (cron) re-fetches and re-scores only new jobs.

**Open questions to confirm with stakeholders:**
- Is a missed strong match (false negative) worse than a mediocre one shown (false positive)? That sets the shortlist size (40) and the tier cut-offs, the main cost dials.
- Should hard constraints (visa, location, salary floor) be explicit inputs instead of inferred from the resume?
- How often should refresh re-score for returning users? It costs money per user per new job, so daily may be enough.

**Acceptance criteria (all verified on the current build):**
- [x] Upload/paste a resume and see matches end to end, with progress streamed live (curl `-N` and headless Chrome at 1280px and 390px).
- [x] Jobs from all 10 boards (3,271 at last run); a failed board is shown clearly and the search continues (`SIMULATE_BOARD_FAILURE=linear`).
- [x] Every match explained by Sonnet with evidence-based reasons, gaps, a score breakdown and location fit; Strong ≥70 first, then Good 55–69, never empty for a reasonable resume.
- [x] Real cost on every run: "Cost to compute" plus per-stage cost, and "Served from cache · $0 spent" on repeats (cost stored with the cached result).
- [x] India-based candidates see India and truly remote roles above US on-site (India test resume: every match India-based or remote-anywhere).
- [x] Explainable cards, filters (company, tier, workplace, India-friendly), sort (score, newest), compare 2–3 side by side.
- [x] Career copilot on demand, fast tier, cost per click; Simulate re-runs only the free stage.
- [x] Clerk accounts: public landing, protected dashboard/ops, APIs return 401 JSON without a session; history, new jobs since last visit, quota 5/day, per-user rate limits, thumbs up/down that nudge ranking.
- [x] Refresh re-scores only new jobs for stored users; quality panel; /ops with board health, caches, per-stage calls/tokens/cost, cost today, average per candidate and a 1k/10k/100k projection.

## 2. Architecture

```
Browser: public landing (/), dashboard (/dashboard, signed in), ops (/ops, signed in)
   |  proxy.ts (Clerk): redirects signed-out page visits; every API also checks auth() itself -> 401 JSON
   |  POST /api/match/stream (SSE)  -> lib/match-request.ts (auth, per-user limit, quota) -> lib/pipeline/run.ts
   |  POST /api/copilot, /api/copilot/simulate, /api/quality, /api/feedback, GET /api/me, /api/matches/:id, /api/ops
   |  POST /api/refresh (cron: Bearer CRON_SECRET) -> lib/refresh.ts
   v
lib/pipeline/run.ts   (result cache hit -> replay stored events at $0)
   |-- in parallel: profile (Haiku, thinking off) + shared board snapshot (10 boards, per-board progress events)
   |-- prefilter in code (title, skills, level, location fit, feedback nudge) -> top 40      free, ~70ms
   |-- shared job digests: use warm ones; digest the rest in the background (Haiku, 2 slots) -> platform cost
   |-- Haiku scores 40 (4 x 10): score + skills/seniority/domain sub-scores + one gap        ~$0.004
   |-- Sonnet explains + calibrates the best <=10 (2 x 5): score, reasons, gaps            ~$0.03
   v
tiers (Strong >= 70, Good 55-69, else Closest 3) -> MatchResult + run context -> in-memory stores (globalThis)
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 App Router, Tailwind, a few client components, native `<dialog>`/`<details>` | One deployable app; no component or animation libraries |
| Live progress | SSE from a route handler, read with a fetch body reader | One-way progress; plain HTTP; EventSource can't POST |
| API | Route handlers + `lib/api.ts`, `lib/rate-limit.ts`, zod | One error shape, validated input, `Retry-After` on every 429 |
| Auth | Clerk `@clerk/nextjs` 7.10.1, `proxy.ts`, embedded sign-in/up | Keys in `.env.local` only; APIs answer 401 JSON (Clerk's protect would 404 a fetch) |
| Data | In-memory maps on `globalThis` (`lib/singleton.ts`) | Brief allows memory; survives dev recompiles; interfaces ready for Redis/Postgres |
| LLM | Haiku (profile, scoring, digests, copilot), Sonnet (explain, quality judge), `effort: low`; thinking off for pure extraction | Cheapest tier per job; Sonnet only where users read the words |

**Data model:**

```ts
type Job = { id /* "gh:stripe:123" */; company; title; location; workplace: "remote"|"hybrid"|"onsite"|"unknown"; countries[]; regions[]; remoteGlobal; department; url; postedAt?; description; contentHash };
type Profile = { isResume; headline; seniority; yearsExperience; country; targetTitles[] /* fit to years in code */; skills[] /* grounded in resume */; domains[]; locations[]; openToRemote; highlights[] };
type ScoredJob = { job; score; tier: "strong"|"good"|"closest"; breakdown: { skills; seniority; location; domain }; reasons[]; gaps[]; locationFit: { score; label; indiaFriendly } };
type MatchResult = { id; createdAt; servedFromCache; profile; stats; funnel: { scanned; prefiltered; scored; explained }; matches: ScoredJob[]; cost: { computeUsd; spentUsd; byStage; calls; inputTokens; outputTokens }; feedbackCount; digests: { cached; computed } };
// per user (in memory): runs[], quota { day, used }, votes Map<jobId, ±1>, lastSeenAt/previousVisitAt, newMatches[]
```

**API contract (all JSON errors are `{error:{code,message,fields?}}`):**

| Method | Path | Auth | Request → Response | Notable errors |
|---|---|---|---|---|
| POST | /api/match/stream | user | `{resumeText}` → SSE: `cached`, `board`, `digest`, `stage`, `cost`, `result` / `error` | 400, 401, 413, 422 not_a_resume, 429 rate_limited / quota_exceeded, 503 busy (global ceiling or daily budget) |
| POST | /api/match | user | same → `{data: MatchResult}` | same as above, 502/504 llm_* |
| GET | /api/matches/:id | owner | → result + `closedJobIds` | 400, 401, 404 |
| POST | /api/resume | user | multipart `file` (PDF/TXT ≤5 MB, ≤20 pages) → `{text, truncated}` | 413, 415, 422 |
| POST | /api/copilot | owner | `{action: coach, resultId}` or `{action: tailor|outreach|prep, resultId, jobId}` → `{output, costUsd, cached}` | 404 job_not_found, 502 ungrounded (tailor) |
| POST | /api/copilot/simulate | owner | `{resultId, addSkills[], addTitles[]}` → `{added, before, after, examples, costUsd: 0}` | 404 |
| POST | /api/quality | owner | `{resultId}` → agreement, precisionAt5, falseNegativeRate, items, costUsd | 404 |
| POST | /api/feedback | owner | `{resultId, jobId, vote: 1|-1|0}` → `{ratings}` | 404 |
| GET | /api/me | user | → runs, quota, newJobsSinceLastVisit, votes, newMatches | 401 |
| GET | /api/ops | operator (`OPS_USER_IDS`; any user in dev) | → boards, caches, LLM by stage, cost today, avg per candidate, quality, projection | 401, 403 forbidden |
| POST | /api/refresh[?simulate=0-10] | cron (prod) / user (dev) | → added, closed, users checked / failed / skipped, jobs re-scored, new matches, cost | 400 bad simulate, 401, 429 per caller, 503 not_configured (prod without secret) |
| GET | /api/jobs | public | → total, boards, fetchedAt | 503 boards_unavailable |

## 3. Design Q&A

_Format: question, then the answer exactly as I would say it._

**Q: Why did you choose this stack?**
A: One Next.js app with API routes, TypeScript and zod. It's the fastest thing to build and demo, there's one deploy, and the server and client share types. Nothing here needed Python.

**Q: Why this data model?**
A: I normalise both Greenhouse and Ashby into one small `Job` type at the edge, so the rest of the app never knows which board a job came from. IDs are prefixed with the board and company so they're unique. I strip HTML once at ingest and cap descriptions at 6k characters, so memory stays small and every downstream step works on plain text.

**Q: How do you keep cost low without hurting match quality?**
A: It's a funnel, and each step only pays for what the next one needs. Plain code ranks all 3,300 jobs for free and keeps 40. Haiku, which costs a twentieth of Sonnet, scores all 40 with sub-scores. Sonnet only explains and re-scores the best ten, the cards people actually read. Job requirements are condensed once into shared digests that every candidate reuses. And a repeat search is served from cache at $0. The quality panel is how I check the cheap stages aren't losing good jobs: on two test resumes the independent Sonnet judge agreed 10 out of 10.

**Q: What does it cost per candidate?**
A: About 3.5 cents for a fresh search, and I show it on every result. The maths: the Haiku profile is about 1k tokens in, so $0.0003. Haiku scoring is four calls of about 5.5k in and 1.2k out, so about $0.004. Sonnet explaining is two calls of about 3.5k in and 0.8k out, so 7k times $2 per million plus 1.6k times $10 per million: about $0.03. That's about $0.035 in total, with Sonnet output as the biggest single line. When the job digests are already warm it drops to about 3.1 cents and runs in about 12 seconds instead of 16 to 20. A repeat is $0. Copilot clicks are a tenth of a cent each and the quality check is about 2 cents. At 100,000 candidates a month that's about $2,500 with the shared caches versus about $3,600 without, and /ops shows that table live.

**Q: Why two models for scoring?**
A: Haiku is twenty times cheaper than Sonnet, so it scores all 40 shortlisted jobs with sub-scores for skills, seniority and domain. Sonnet then explains and re-scores only the best ten, which are the cards a user actually reads. That doubled the jobs we judge and cut cost from 6 cents to about 3.4 cents per candidate. The quality panel checks that the cheap stage isn't throwing good jobs away.

**Q: How do you make sure the user never sees an empty page?**
A: Strong is 70 and up, Good is 55 to 69, and Strong always comes first. If nothing reaches 55, we still explain the top three and label them "Closest available", with honest gaps. Only a resume that shares no title or skill with any of the 3,300 jobs gets an empty result, and it gets an explanation instead.

**Q: How is location handled for someone in India?**
A: Every job is normalised to countries and regions in code. Ashby gives a structured workplace type, which we trust; its `isRemote` flag is true for hybrid roles, so we ignore that one. Greenhouse has no workplace field, so we only say remote or hybrid when the posting says so and never guess on-site. Then a deterministic location fit ranks same-country and remote-anywhere roles above on-site roles abroad, and the models see that verdict instead of guessing geography.

**Q: Why Server-Sent Events and not WebSockets?**
A: The traffic is one-way: the server reports progress and the browser just listens. SSE is plain HTTP from a normal route handler, works through CDNs and load balancers, and needs no extra server. I use a fetch body reader because EventSource can't POST a resume. If the user closes the tab, the shared run still finishes and fills the cache, so a retry is free.

**Q: How do you keep the copilot cheap?**
A: Nothing runs until you click, every action uses Haiku, and each button shows what it cost: about a tenth of a cent. Answers are cached, so reopening is free. "Simulate" doesn't call a model at all: it adds the suggested skills to your profile and re-runs the free prefilter, so I can say "+2 more jobs would qualify" for zero dollars.

**Q: How do you protect the AI endpoints?**
A: Clerk handles sign-in. The proxy only redirects pages; each API route checks the session itself and returns a 401 in our normal error shape, because Clerk's protect helper returns a 404 to API calls. Rate limits are per user, not per IP, so they can't be dodged with a fake header. Each user gets five new searches a day, but re-running one they've done is free. There's also a global per-instance ceiling as a last line on spend.

**Q: How does feedback change ranking?**
A: A thumbs-up adds a small boost to that company and to the words in that job's title, and a thumbs-down subtracts. It's capped at 0.15, so it nudges and never overrides fit. It's applied in the free prefilter and as a tie-break within each tier, and the user's feedback is part of the cache key, so they never get a stale ranking. In testing, one thumbs-up on a Ramp role put four Ramp backend roles in the top five.

**Q: What is the shared job-level cache?**
A: Haiku condenses each job's requirements once into a digest: must-haves, nice-to-haves, level and domain. It's keyed by job id and content hash and shared by every candidate. Digests are computed in the background using at most 2 of the 8 model slots, so they never slow anyone's search; whoever comes next with an overlapping shortlist gets them free. Digesting the whole catalogue costs about 50 cents, at $0.00015 a job. A warm run cost 3.1 cents in 12 seconds versus 3.5 cents in about 17. That's the per-candidate saving the /ops projection is built from.

**Q: How does the refresh pick up new jobs without re-running everyone?**
A: It re-fetches the boards and diffs them into new and closed jobs. For each stored user it runs only the new jobs through the free prefilter, against the cut-off that user's shortlist used. Only jobs that would have made their top 40 get a Haiku score, and only Good-or-better ones get a Sonnet explanation. So cost scales with new jobs that plausibly fit, not with the catalogue. In a demo run, 5 new jobs were all re-scored, giving 4 new matches for 1.3 cents.

**Q: Why not just embed everything and do vector search?**
A: It would work, but for 3,300 jobs keyword and title scoring is free, instant and explainable, and it got good shortlists in testing. Embeddings are the next step when the job pool grows to hundreds of thousands, or if prefilter recall turns out weak.

**Q: How does this handle 10x and 100x more users?**
A: Everything job-side is shared, not per user: one board snapshot and one digest cache, so growth only scales the per-candidate LLM calls. Those are capped per user (5 new searches a day, 10 a minute), with a global ceiling and a concurrency cap, and repeats are free. At scale the in-memory maps move to Redis and Postgres, searches go through a queue with the SSE stream fed from it, and refresh becomes a cron worker using the Batch API. Details are in SCALE.md section 7.

**Q: What happens when the Claude API is slow, down or returns bad output?**
A: `lib/llm.ts` has a timeout, SDK retries and one schema-repair retry, and a cut-off reply gets a bigger token budget on the retry. The whole pipeline has a 45-second deadline, so the user gets a clean "took too long, retry" instead of a hang, and the wait queue is capped so a burst fails fast instead of piling up. The four scoring batches are independent: if one fails, the user still gets the others, and the result says how many roles couldn't be reviewed instead of hiding it. If all fail, the user sees "Our AI matcher is busy, your resume is fine" with a Retry button. Ids the model invents are dropped, and duplicates are ignored.

**Q: What if a job board is down?**
A: Boards are fetched with `Promise.allSettled` and a 20-second timeout each. A failed board keeps its last good jobs, marked stale, and the UI says which company couldn't be reached. The search only fails if all 10 are down.

**Q: How do you protect against prompt injection and bad input?**
A: Every input is validated with zod for length and type, and bodies are capped while they stream in, so a chunked upload can't skip the limit. Uploads are checked by magic bytes, not file extension, capped at 5 MB and 20 pages. The resume and job text go inside data tags, and I neutralise any closing tag inside them, so a job posting can't break out and tell the scorer what to do. Model output is validated against a schema, and React renders it as plain text, never HTML. Job links come from the board APIs, must be https, and never come from the model. Error responses send a fixed message per error type; the details stay in server logs.

**Q: Which model did you use, and why?**
A: Haiku 5.5 for everything structured or high-volume: the profile, scoring 40 jobs, job digests and copilot. Sonnet 5.5 only where people read the words or where judgement matters most: explanations, and the independent quality judge. Everything runs at low effort. For pure extraction (profile and digests) I turn thinking off, because thinking tokens bill as output; that halved the digest output and stopped it hitting the token cap. I didn't use Opus: twice Sonnet's price with no visible gain here.

**Q: How does "come back anytime" work?**
A: Every signed-in user has a history of their runs, with date, top matches and cost, and any run reopens for free. Results are owner-only. On return the dashboard says how many jobs were posted since the last visit and lists new matches found by the scheduled refresh. Closed roles in a saved result are flagged. The resume also stays in that browser, so "Check for new jobs" re-runs it; unchanged work comes from cache.

**Q: How do you know the matching is any good?**
A: There's a quality panel. Sonnet independently judges our top 5 matches and the 5 most borderline jobs we rejected, without seeing our scores and with the order shuffled. It reports agreement, precision of the top 5 and the false-negative rate. On an India backend resume and a US frontend resume it agreed 10 out of 10 both times: precision 100%, false negatives 0%, about 2 cents a check. I'm honest that this is 10 jobs per check and a judge from the same model family, so it catches regressions; it's not a human-labelled eval. That eval is the first next step.

**Q: Two identical searches arrive at once. What happens?**
A: They share one run. `runMatch` is single-flight on a hash of the resume, so a double click, two tabs or a retry after a refresh attach to the run already in progress and get the same result id, and the second one costs nothing. I chose that over cancelling the run when the client disconnects, because the two conflict: with a shared run, one caller leaving shouldn't kill the other's result. A finished run also fills the response cache, so retrying later is free.

**Q: What if someone pastes something that isn't a resume?**
A: Two gates. A free one first: under 20 distinct words is rejected before any model call, which catches padding like "aaaa". Then Haiku's profile has an `isResume` flag, so a pasted job posting or essay stops with a clear 422 before the expensive Sonnet calls. Without the flag the schema forced Haiku to invent a profile.

**Q: How do you stop the model inventing skills?**
A: After Haiku extracts the profile, plain code keeps only the skills that actually appear in the resume text. An invented skill can't steer the shortlist or show up as a reason. If none match verbatim, for example a translated resume, I keep the model's list rather than none.

**Q: Why does the refresh endpoint refuse to run without a secret?**
A: It fans out to ten third-party APIs and can spend money re-scoring, so in production it only accepts the scheduler's Bearer token, compared in constant time, and returns 503 if no secret is configured. In local dev a signed-in user can trigger it from /ops, with an optional, clearly labelled "simulate 5 new jobs" for demos.

**Q: Rate limits can be dodged by faking the IP header. What did you do?**
A: The key now comes from the platform's IP header, or the last forwarded hop, never the client-controlled first one. Because headers can still be faked on some setups, `/api/match` also has a per-instance global ceiling of 60 a minute. That puts a hard cap on LLM spend whatever the IP says. In production both move to Redis.

**Q: Why not score with Haiku to save money?**
A: That's now what we do, in two stages. Haiku scores all 40 shortlisted jobs, and Sonnet re-scores and explains only the ten best. That cut cost from 6 cents to about 3.5 while doubling the jobs we judge. Sonnet still writes every explanation a user reads, and the quality panel watches that Haiku isn't rejecting jobs a stronger model would keep.

**Q: How do you make sure the 5-a-day quota can't be beaten?**
A: The first version checked the quota before a search but only counted it once the search finished, 15 seconds later, so ten parallel requests all passed. Now the search is reserved up front and given back if it fails, comes from cache, or joins a run already in flight. Only the caller that actually started a paid run is charged. I checked it with seven parallel requests: five got through, two got a 429, and all five were refunded when they failed.

**Q: What happens if Sonnet is down in the middle of a search?**
A: Haiku has already scored every shortlisted job by then, so I keep those scores and say plainly on the result that the explanations are missing. I don't throw away a search that's already been paid for. A partial result like that isn't cached, so "run it again" really does retry.

**Q: Is a repeat search really free?**
A: Yes, as long as the job list hasn't changed. The cache is tied to the job snapshot, which refreshes at most every 30 minutes, because a cached result after a refresh could show closed jobs and miss new ones. The quota message says that honestly. The next step is an incremental re-run that only scores the new jobs, like the scheduled refresh does.

**Q: What stops someone draining your API key with lots of free accounts?**
A: Sign-up is open, so a per-user quota isn't enough. There's a daily platform-wide spend budget (`DAILY_BUDGET_USD`, $25 by default) checked against what was actually spent today, on top of the 60-a-minute global ceiling. The /ops page, which shows platform-wide spend, is limited to an operator allowlist and fails closed in production.

**Q: How do you stop the model inventing achievements?**
A: Same idea as skills: check against the resume in code. A profile highlight that quotes a number the resume doesn't contain is dropped before Sonnet sees it. A tailored bullet whose "before" doesn't actually come from the resume is dropped. The outreach prompt is told to use only facts from the resume.

**Q: What did you deliberately leave out, and why?**
A: A real database, email alerts, DOCX and OCR, and automated tests. The brief allows memory. The refresh already finds new matches; sending emails is a delivery problem, not a matching one. Tests need a new dependency in a live build, so the pure functions (filters, location, prefilter, tiers, funnel reducer) are written to be easy to test first.

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
| 22 | Upgrade phase 2: live pipeline over SSE | `POST /api/match/stream` streams board, stage, cost and result events (`lib/sse.ts`, heartbeat, `no-transform`). Identical concurrent runs share one channel that replays missed events; a cached result replays its stored events at $0. Client reads frames from a fetch body (EventSource can't POST). Funnel: boards tick green with counts, four stages fill, cost ticks per stage. Verified with `curl -N` (profile 2.6s, Haiku 6s, Sonnet 13s, $0.0348) and headless Chrome at 1280px and 390px |
| 23 | Upgrade phase 3: explainable matches | Cards show a score badge, four breakdown bars (skills, seniority and domain from Haiku; location computed in code), why-you-match, gaps, location fit, posted date and Apply. Filters (company, tier, workplace, India-friendly) and sort (best match or newest) are pure functions in `lib/filters.ts`. Compare uses a native `<dialog>`. The headless check caught the sticky compare bar covering the next checkbox on mobile; fixed by moving Compare into the card's action row and adding scroll padding |
| 24 | Upgrade phase 4: career copilot | Fast tier, runs only on click, cost shown per click: coach $0.00095 (3 changes from gaps across the top 20, each linked to the jobs it unlocks), tailor $0.00064, outreach $0.0003, prep $0.00045. "Simulate" re-runs only the free prefilter with the suggested skills and titles ("+2 more jobs would qualify", $0). Run context (resume, full profile, shortlist scores) stays server-side. Caught in screenshots: prep called the candidate "her", a gender guessed from the name; every candidate-facing prompt now speaks to "you" and is told never to assume gender. Re-verified: no gendered words |
| 25 | Upgrade phase 5: accounts with Clerk | `@clerk/nextjs` 7.10.1, keys only in `.env.local`. `proxy.ts` (Next 16's middleware) redirects /dashboard and /ops to our embedded /sign-in; every API checks `auth()` itself and returns 401 JSON, because `auth.protect()` returns 404 to fetches. Public landing page; "Try with sample resume" goes sign-up → `/dashboard?sample=1`, which auto-runs. Per-user history, quota (5 new searches a day; repeats free), userId rate limits, owner-only results, thumbs up/down nudging rankings (±0.15 cap; the feedback is part of the cache key). Verified with a Clerk dev test user: 401 without a session; one Ramp 👍 → four Ramp roles in the top five; 6th new search → 429 with Retry-After; repeat allowed. The headless check caught dev recompiles wiping in-memory state mid-demo; stores now live on `globalThis` (`lib/singleton.ts`) |
| 26 | Upgrade phase 6: system thinking | **Shared job digests** (`lib/digests.ts`): Haiku condenses each job once (keyed by id + content hash) in the background, at most 2 model slots, booked as platform cost. **Refresh** (`lib/refresh.ts`, `POST /api/refresh`): diff, then re-score only new jobs that would make each user's shortlist. **Quality panel**: an independent Sonnet judge on 5 matches + 5 borderline rejects. **/ops**: board health, cache hit rates, LLM calls/tokens/cost by stage, cost today, average per candidate, 1k/10k/100k projection from measured runs. Measured: cold $0.035 (~16–20s), warm digests $0.031 (12s), digest $0.00015/job, refresh 5 new → 4 matches $0.013, quality 10/10 agreement on two resumes ($0.019) |

| 27 | Review 2: quota | Quota reserved in `prepareMatch` (`reserveRun`), refunded when the run fails, is cached or joins one in flight; `runMatch` returns `created` so only the starter is charged; history dedupes by id; Cmd/Ctrl+Enter ignored while pending; a run already in flight counts as free. Verified: 7 concurrent → 5 reserved + 2× 429, all refunded on 422 (used 0); 2 identical concurrent streams → one id, used 1, one history row; repeat → cached, $0, used still 1 |
| 28 | Review 2: resilient search | All Sonnet batches failing falls back to Haiku scores with `stats.unexplained` and a note on the result; partial results (unscored or unexplained) are not cached; a stream that ends with neither result nor error shows Retry; `<Results key={result.id}>` resets selection and filters when opening a past run. Verified clean run: unscored 0, unexplained 0, $0.0355, 16s |
| 29 | Review 2: refresh | Per-user try/catch and a 30s deadline per user, 90s overall budget, `usersFailed` / `usersSkipped` in the report and on /ops; jobs the user was already shown are never re-reported as new (simulated jobs come from unshown shortlist jobs); closed jobs hidden from new matches; `?simulate` validated (abc → 400); rate limit per caller, scheduler separate. Verified: simulate=5 → 4 new matches, 0 already shown, $0.0158 |
| 30 | Review 2: security | Results owner-only by type (`ownerId` required, null branch removed); `/api/ops` behind `requireOps` (`OPS_USER_IDS`, fails closed in prod); daily spend budget; simulate limit 60 → 10/min and uses the user's feedback nudge like the bar; `neutralise` covers `resume`/`gaps`/`matches` tags; resume text moved to `sessionStorage` |
| 31 | Review 2: grounding and limits | Highlights with numbers not in the resume dropped; tailor bullets need ≥60% of "before" words in the resume (verified: 3 of 3 kept, $0.00044); outreach grounding rule; 40s timeouts on copilot and quality calls; dated model ids priced by family with a one-time `unknown_model_price` warning; CJK/Thai distinct characters count as words (Japanese resume now passes, "a "×300 still 400) |

**Where the AI got it wrong and how it was caught:**
- The scaffold commands assumed `cp -n` exits 0. I caught it because the build listing still showed `scaffold-tmp` and AGENTS.md, and the package name hadn't changed.
- It added `export const runtime = "nodejs"` per the template, which breaks under Next 16 `cacheComponents`. I caught it from the dev-server log on the first curl.
- The zod "required" message also fired for wrong types. I caught it by sending `{"resumeText":123}` in the edge-case pass.
- The scorer stated an outside "fact" in a gap ("Stripe's stack is mostly Java/Ruby", which wasn't in the text it was given). I caught it by reading the reasons on the first real run, not just checking that it returned 200. The fix tightened the prompt; the next run then padded with a filler gap, so I also allowed `[]` for gaps. Both were verified on a real run.
- In review, 12 agents found that "Check for new jobs" deleted the saved result after a reload, and that a plain "Engineering Manager" title scored as the wrong level for manager candidates. Neither shows up in a happy-path curl test. Both were fixed and re-verified.
- The docs claimed the prefilter took 10ms. I measured about 70ms on real board data and corrected the docs instead of keeping the nicer number.

- First digest design waited for digests before Sonnet and ran 8 batches at once: a 30-second search, and every batch hit its token cap because Haiku spent the budget on thinking. I caught it from the latency in the run output and the `out: 2000` log lines. Fixed by moving digests to the background at 2 slots, turning thinking off for extraction (output halved) and trimming over-long lists instead of failing.
- First refresh gate used the bar of the weakest current match, so no new job could ever pass: every job above it is already in the shortlist. Caught when a simulated refresh re-scored 0 jobs; the gate is now "would this job have made the user's top 40".
- In-memory state (users, history) was wiped whenever the dev server recompiled a new page, which would have broken the demo the first time someone opened /ops. Caught by a headless sign-in test showing 5 of 5 searches left after 5 had been used. All stores now live on `globalThis`.
- The prep answer called the candidate "her", a gender the model guessed from a name; caught in a screenshot. Every candidate-facing prompt now speaks to "you".
- The daily quota was counted after a search finished, so parallel requests all passed the check, and two tabs on the same resume were charged twice for one run. No happy-path test shows it; four reviewers found it by reading the code. Now the quota is reserved up front and refunded, and I verified it with 7 parallel requests.

## 5. Edge Cases Handled

| Case | Behaviour |
|---|---|
| Empty / whitespace / <200 chars | Client blocks with message; server 400 field error |
| >30,000 chars | Live counter turns red; server 400 |
| Malformed JSON / missing / wrong-typed field | 400 `invalid_json` / `validation_error` with field message |
| Empty, oversized, non-PDF/TXT, corrupt or scanned PDF | 400 / 413 / 415 / 422 with a human sentence suggesting paste |
| Non-English resume, emoji | Profile is written in English; tokenizer is Unicode-aware (tested with Spanish); Chinese/Japanese/Thai count distinct characters, so they aren't rejected as "not a resume" (tested with Japanese) |
| One board down or slow (20s timeout) | Uses last good jobs (marked stale) and the UI names the board; all down → 503 |
| LLM slow / rate-limited / bad JSON / invented ids | Timeout + retries + schema repair; partial batches survive; friendly retry message |
| Double submit / two tabs / stale response | Button and Cmd/Ctrl+Enter ignored while pending; new submit aborts the old fetch; identical concurrent resumes share one server run, one id, one history row and one quota charge |
| Not a resume (padding, job posting, essay) | <20 distinct words → 400 before any LLM call; Haiku `isResume: false` → 422 before Sonnet |
| Oversized or chunked body | Capped while streaming: JSON 200 KB → 413, upload 5 MB → 413; PDFs over 20 pages → 422 |
| LLM hangs or queue floods | 45s pipeline deadline → 504 with retry; queue over 100 → 503 overloaded |
| Some scoring batches fail | Result shows "N of the closest roles couldn't be reviewed, run again"; partial results aren't cached, so the re-run really retries |
| Every Sonnet batch fails | Haiku's scores are kept; the result says explanations are unavailable for N roles (no wasted paid search) |
| Stream ends with no result (platform cut, proxy) | "The connection dropped" with Retry, never a silent stop |
| Re-running while results are shown | Skeleton replaces the old result (no stale links to click); old result returns if the new run fails |
| Abuse | Per-user limits (match 10/min, upload 20/min, simulate 10/min, refresh 2/min per caller) with `Retry-After`; global match ceiling 60/min per instance; refresh needs `CRON_SECRET` in production |
| Saved link expired / bogus id | 404/400 forget the link silently; a network error or 429 keeps it and offers Retry |
| "Check for new jobs" after a reload | Re-runs the resume saved on this device; on another device asks for the resume and keeps matches visible |
| Matched job closed since | "Closed since your search" badge, struck-through title, no apply link |
| Accessibility | Labelled inputs, aria-live announcements, visible focus rings, Cmd/Ctrl+Enter |
| Signed out | Pages redirect to /sign-in (return URL kept); every API returns 401 JSON |
| Over the daily quota | 429 `quota_exceeded` with `Retry-After` to UTC midnight; reserved before the run, so parallel requests can't exceed it; a repeat is free while the job snapshot is unchanged (≤30 min) |
| Many accounts / runaway spend | Daily platform spend budget (`DAILY_BUDGET_USD`) → 503 busy; /ops only for `OPS_USER_IDS` |
| Refresh: one user's LLM calls fail | Counted in `usersFailed`; every other user is still refreshed; the report is never lost |
| Someone else's result id | 404 (owner-only), never another user's data |
| Nothing scores 55+ | Top 3 shown as "Closest available" with honest gaps |
| Workplace not stated (Greenhouse) | Place shown without a guessed "On-site"; filter groups it with on-site as "On-site or not stated" |
| Same role posted per city | Collapsed to the best-fitting posting before any model call |
| Digest or background work fails | Logged; searches carry on without digests (they're an optimisation) |
| Dev server recompiles mid-demo | Users, history, caches and metrics survive (`globalThis`) |

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
| correctness ×2, security, edge-case ×2 (review 2) | Quota counted after the run: parallel requests bypassed it; joining your own in-flight run charged twice and duplicated history ids | Reserve in `prepareMatch`, refund on failure/cache/join; `runMatch` returns `created`; history dedupes by id; in-flight runs count as free; shortcut respects `pending` |
| correctness, llm-usage (review 2) | One failed Sonnet stage failed the whole paid search; failed explain batches went unreported | Fall back to Haiku scores; `stats.unexplained` + note on the result |
| llm-usage (review 2) | Partial results cached, so "run again" returned the same partial result | Only complete results are cached |
| correctness, llm-usage (review 2) | Refresh: one LLM error aborted all users; shared 60s deadline | Per-user try/catch and deadline, overall budget, `usersFailed` / `usersSkipped` |
| correctness (review 2) | Refresh "new matches" were roles the user had already seen; closed ones lingered | Exclude the latest result's matches; simulated jobs from unshown shortlist jobs; closed hidden in `/api/me` |
| correctness (review 2) | Opening a past run kept stale compare selection and filters | `key={result.id}` on `<Results>` |
| correctness (review 2) | Simulate bar included the feedback nudge but the comparison didn't | Same nudge passed to both `rankAll` calls |
| correctness (review 2) | Stream ending with no result or error looked like success | Treated as "connection dropped" with Retry |
| security (review 2) | No platform-wide spend cap with open sign-up | `DAILY_BUDGET_USD` (default $25) against today's measured spend → 503 |
| security (review 2) | `/api/ops` open to any signed-in user | `requireOps()`: `OPS_USER_IDS` allowlist, fails closed in production |
| security (review 2) | Results readable by id when owner was null (latent IDOR) | `ownerId` required in `saveResult`/`RunOptions`/getters; null branch removed |
| security (review 2) | Simulate: two full prefilter passes at 60/min | Limit 10/min |
| security, llm-usage (review 2) | `neutralise` missed `<resume>`, `<gaps>`, `<matches>` | Regex covers every wrapper tag |
| security (review 2) | Resume text persisted in localStorage on shared devices | `sessionStorage` (gone with the tab); old localStorage copy removed |
| llm-usage (review 2) | Highlights not grounded (main remaining hallucination path) | Highlights citing numbers absent from the resume are dropped |
| llm-usage (review 2) | Tailor "before" could be invented; outreach had no grounding rule | "Before" must share ≥60% of words with the resume; outreach told to use only resume facts and never guess gender |
| llm-usage (review 2) | No timeout on copilot/quality calls | `AbortSignal.timeout(40s)` |
| llm-usage (review 2) | Unknown model ids silently priced as Sonnet | Dated ids priced by family prefix; one-time `unknown_model_price` warning |
| edge-case (review 2) | Japanese resume rejected as "not a resume" | Distinct CJK/Thai characters count as words |
| edge-case (review 2) | `?simulate=abc` silently 200; any user could starve refresh | zod-validated (400); limit per caller, scheduler separate |
| edge-case (review 2) | 429 said repeats are always free | Message now says free while the job list is unchanged (≤30 min); contract row for `/api/copilot` now lists `resultId` |

**Known tradeoffs (talking points, not fixed):**

| Agent | Issue | What I'd do with more time |
|---|---|---|
| data-model ×6, scalability | Results, job snapshot and refresh diffs live in per-process memory; FIFO cap of 1,000; no job table, resume hash, model/prompt version or delete route | The brief allows in-memory. Next step: the Prisma `Job`/`Candidate`/`Match` schema from the data-model review (soft-closed jobs, `resumeHash`, `promptVersion`, `expiresAt` cleanup, delete-my-data), with Redis for hot reads (SCALE.md §7) |
| scalability | LLM response cache is per-process (500 entries, 10 min), so repeat-is-free only holds on one instance | Redis with the same sha256 key, plus `profile:` and `score:<profile>:<job>:<content_hash>` caches |
| scalability, llm-usage | Pipeline runs inside the HTTP request; client disconnect doesn't cancel the run | Deliberate for now: single-flight conflicts with abort-on-disconnect, and a finished run fills the cache so a retry is free. At scale: 202 + queue + polling (SCALE.md §7) |
| scalability | Each instance fetches boards itself; `/api/jobs/refresh` updates one instance | Cron worker publishes a versioned snapshot to Redis/S3 |
| llm-usage | Sonnet scores all 20 jobs (~98% of cost) | **Done in the upgrade:** Haiku scores 40, Sonnet explains ≤10 (build log 18) |
| llm-usage | Highlights not grounded; no `server-only` guard | Near-verbatim highlights with a numbers check; `server-only` needs a new dependency, so it's left as a comment rule |
| correctness | Country-only profile locations ("USA") never match city job locations (0.6 penalty) | **Done in the upgrade:** country/region normalisation in `lib/location.ts` (build log 20) |
| test-coverage ×5 | No test runner or tests | Add vitest (new dependency, out of scope for the live build): `generateJSON` repair path, `scoreShortlist` partial failure, `shortlist` fixture, route 400s, board fallback |
| maintainability | `lib/llm.ts` is 262 lines (kit helper, extended); two TTL caches | **Done in the upgrade:** runtime plumbing moved to `lib/llm-runtime.ts` |
| maintainability | Prefilter weights and cutoffs unnamed; level words listed twice | Name them alongside the eval that will tune them |
| ui-ux ×4 | Busy hero card; near misses as nested cards; long cards; four controls on the input card | Profile in a `<details>`, compact near-miss rows, 2 reasons + 1 gap, quieter "Try an example" |
| ui-ux | "One accent" for score badges | Not changed: the kickoff spec defines emerald/amber/rose score colours. Contrast fixed |
| edge-case (×2, incl. review 2) | 405 responses have an empty body | Explicit 405 handlers with the JSON error shape and `Allow` |
| edge-case | `[]`/`null` body gives a technical zod message | Acceptable (400 with field); could map to "Send a JSON object with resumeText" |
| security | Saved links are 7-day bearer URLs with profile data | UUIDv4 in the URL hash (never sent in Referer); bind to a cookie if sharing isn't wanted |
| error-handling | Board load has no retry when no cache exists; upload error has no retry button | Retry the board load once; add a "Try again" next to the upload error (the message already suggests pasting) |
| edge-case (2 rows) | Whitespace padding and bad ids/uploads | False positives: reviewer confirmed correct behaviour, no change needed |
| edge-case, correctness (review 2) | A repeat after the job snapshot refreshes costs a search | Partly fixed (honest message). Next: an incremental re-run that reuses the stored run and scores only new jobs, so a repeat stays free and current |
| edge-case (review 2) | Extensionless (`/etc/hosts`) and `.json` uploads get 415 | False positive: the contract is PDF or `.txt`, and the message says so |
| edge-case (review 2) | Copilot error blames `resultId` | False positive: `resultId` really was the missing field; the docs contract was wrong and is fixed |
| llm-usage (review 2) | Quality top 5 may include "closest" jobs | False positive: `assignTiers` never mixes tiers, so closest jobs only appear when nothing qualified, and then judging them is the honest result |
| llm-usage (review 2) | Numbers in Sonnet's `reasons` not post-checked | Highlights (its evidence) are grounded now; next, drop reasons citing numbers absent from resume and profile |
| llm-usage, security (review 2) | Refresh runs users one at a time; simulate recomputes `before` each call | At scale each user's re-score is a queued job (SCALE.md §7); cache the simulate baseline per result id |
| security (review 2) | Budget, quota and ops allowlist are per instance | Same counters in Redis (atomic `INCR` for the quota reservation) |
| resolver (review 2) | Tiny window: a run seen in flight at check time that then fails lets a joiner start one unreserved run | Accepted: it needs a failed run plus exact timing, and costs at most one run |

## 7. Demo Script

1. **Setup:** `npm run dev`, open http://localhost:3000. Keys in `.env.local`: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
2. **Landing:** value proposition, the 4-step funnel, and four promises: explainable, honest cost, true location, copilot. Click **Try with sample resume** → sign up → the dashboard opens and runs the sample.
3. **The wow moment:** the live funnel. The 10 boards tick green with job counts, then 3,271 scanned → 40 pre-filtered (free) → 40 scored by Haiku → 10 explained by Sonnet, with the cost ticker per stage (about $0.004 Haiku, $0.03 Sonnet).
4. **Results:** Strong first, then Good. Open a card: score badge, four bars (skills, seniority, location, domain), why you match, gaps, honest location ("Hybrid · New York", or the place alone when the board doesn't say), Apply. Filter to a company or India-friendly; sort by newest. Tick 2–3 cards and press **Compare**.
5. **Cost honesty:** "Cost to compute $0.035". Run it again: the funnel replays and shows **Served from cache · $0 spent**, and the quota doesn't move (free while the job list is unchanged). Open a second tab and run the same resume while the first is running: one run, one charge.
6. **Copilot:** **Get suggestions** ($0.001) → 3 resume changes, each linked to the jobs it unlocks → **Simulate** ("+2 more jobs would qualify", $0, computed in code). On a card: **Prep me** → 5 likely questions with why, cost shown.
7. **Quality:** **Check quality** → the independent judge agrees on 10 of 10, precision of the top 5, false negatives, about 2 cents.
8. **Feedback:** 👍 a Ramp role, search again → "ranked with your 1 rating", and Ramp roles move up.
9. **System thinking:** open **/ops**: board latency, cache hit rates, LLM calls and tokens by stage, cost today, average per candidate, and the projection (100k candidates ≈ $2.5k/month with shared caches vs $3.6k without). Press **Simulate 5 new jobs**: refresh re-scores only those (never roles you were already shown), and the dashboard shows "4 new matches from the latest job refresh" (verified: 4 of 5, $0.016). In production /ops is limited to `OPS_USER_IDS`.
10. **Edge cases if asked:** the India resume (only India and remote-anywhere roles), a .gif upload (415), a pasted job posting (422, no Sonnet spend), `SIMULATE_BOARD_FAILURE=linear` (Linear shown as down, search continues), signed-out API call (401 JSON).
11. **Code to point at:** `lib/pipeline/run.ts` (the whole pipeline and its events), `lib/prefilter.ts` + `lib/location.ts` (free stages), `lib/digests.ts` (shared cache), `lib/cost.ts` + `lib/projection.ts` (cost honesty), `proxy.ts` + `lib/auth.ts`.

**60-second walkthrough:**
"You upload a resume. Haiku reads it into a profile while one shared snapshot of 10 boards, about 3,300 jobs, is already loaded, and you watch each board tick in. Plain code ranks every job on title, skills, level and true location for free and keeps 40. Haiku scores those 40 with a breakdown, and Sonnet explains only the best ten, the ones you'll read. That's about 3.5 cents and 15 seconds. Job requirements are condensed once and shared by everyone, so the next candidate pays less and waits less, and a repeat search is free. Every click on the copilot shows its cost. An independent judge checks the matching, and /ops shows what it all costs at 100k users."

## 8. What I'd Do Next

1. **Human-labelled eval:** 10 resumes × top 30 jobs graded by a person; measure prefilter recall@40, Haiku-vs-Sonnet agreement and the tier cut-offs, then tune `SHORTLIST_SIZE`, weights and thresholds with data. The quality panel is the regression check, not the ground truth.
2. **Persistence:** the Prisma schema from the review (Job with soft-close, Candidate with resumeHash and promptVersion, Match, votes), Redis for the result, response and digest caches, so they're shared across instances.
3. **Queue + Batch API:** searches through a queue feeding the SSE stream; refresh re-scoring through the Message Batches API (50% cheaper) on a cron worker that also pre-digests every new job at ingest.
4. **Score stability near the 70/55 cut-offs:** scores move a few points between runs (the refresh path rated one role 66 that the main run had at 52). Measure it in the eval; consider a band rather than a hard line.
5. **Tests:** vitest on the pure modules first (filters, location, prefilter, tiers, funnel reducer, projection), then the routes.
6. DOCX/OCR resumes, explicit hard filters (visa, location, salary), and email alerts for refresh matches.
