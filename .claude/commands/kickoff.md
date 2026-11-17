---
description: Build the whole project in one pass from a problem statement, with edge cases handled and decisions doc maintained
argument-hint: <paste the problem statement>
---

# Problem statement

$ARGUMENTS

# Your job

You are a startup CTO and senior full-stack engineer working on a tight, time-boxed build (about 40 minutes total). Every choice should be the one you would defend in front of investors: simple, fast, cheap to run, and ready to scale. Build a complete, working, demo-ready solution to the problem above in ONE pass, without stopping to ask for approval. Small and fully working beats big and partly working.

Follow CLAUDE.md. Work through the phases below in order.

## Phase 0: Decide the stack and scaffold the project (do this first, quickly)

The folder contains only this kit (`.claude/`, `lib/`, `docs/`, `CLAUDE.md`, `.env.example`). There is no app yet.

1. **Check the API key.** If `.env.local` does not exist, copy `.env.example` to `.env.local`. If `ANTHROPIC_API_KEY` in `.env.local` is empty and the problem needs an LLM, tell me in one line to paste my key into `.env.local`, then continue building everything else while I do it. Never print the key or show the file contents.

2. **Choose the stack** from the problem and write the choice with one-line reasons into section 2 of `docs/DECISIONS.md`.
   - **Default (use unless the problem clearly needs something else):** Next.js App Router + TypeScript + Tailwind, API route handlers in the same app, zod, the kit's `lib/` helpers. One deployable app, fastest to build and demo, scales horizontally, deploys to Vercel or AWS.
   - Persistence: in-memory store if the demo does not need data to survive a restart; Prisma + SQLite if it does (Postgres named as the production target in `docs/SCALE.md`).
   - Realtime needs (chat, live updates): Server-Sent Events from a route handler before reaching for WebSockets.
   - File uploads: native `FormData` in a route handler with type and size limits; parse PDFs with `unpdf` only if required.
   - Only pick a different backend (e.g. Python + FastAPI) if the problem genuinely depends on a Python-only library. In that case keep the Next.js frontend, and port the patterns of `lib/llm.ts`, `lib/api.ts` and `lib/rate-limit.ts` (validation, error shape, caching, rate limiting) rather than dropping them.

3. **Scaffold without touching the kit files.** `create-next-app` refuses non-empty folders, so scaffold beside it and merge (these exact commands are tested):
   ```bash
   npx --yes create-next-app@latest scaffold-tmp --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --skip-install --yes
   cp -Rn scaffold-tmp/. ./
   rm -rf scaffold-tmp
   rm -f AGENTS.md
   npm pkg set name="$(basename "$PWD" | tr '[:upper:] ' '[:lower:]-')"
   npm install
   npm install @anthropic-ai/sdk zod
   npx next typegen
   ```
   `cp -Rn` never overwrites, so the kit's `CLAUDE.md`, `lib/` and `docs/` stay intact. `AGENTS.md` is removed so `CLAUDE.md` is the only source of rules. The scaffold's `.gitignore` already covers `.env*`; confirm it. `npx next typegen` generates Next 16 route types so `npx tsc --noEmit` works before the first dev run.

4. Start `npm run dev` in the background and confirm it serves on localhost:3000 before writing features.

## Phase 1: Plan (keep it short, then keep going)

1. Restate the problem in one paragraph.
2. Where the problem is ambiguous, choose the simplest reasonable interpretation and write it down as an assumption. List 2-3 questions worth confirming with stakeholders. Do NOT wait for answers.
3. Define 4-6 testable acceptance criteria.
4. Design: data model (TypeScript types), API contract (method, path, request, response, errors), screens, and an ASCII architecture diagram.
5. Decide whether an LLM is genuinely needed; do deterministic work (parsing, maths, filtering, sorting) in plain code. If an LLM is needed, use the existing `lib/llm.ts` helper (`generateJSON` with a zod schema). It already handles prompt caching, response caching, a concurrency limit, retries, timeouts and usage logging; do not reimplement any of that.
   - Model tier per call: `fast` (Haiku) for extraction, classification, tagging; `smart` (Sonnet) for scoring with reasons, comparisons, summaries; `deep` (Opus) only if the task truly needs multi-step reasoning. State the choice and the reason in DECISIONS.md.
   - Keep `maxTokens` tight (usually 300-800) and the output schema compact: scores, enums, short reason strings. Output tokens drive cost and latency.
   - Keep the system prompt static (no user data in it) so prompt caching works; put all user data in `input`.
   - Prefer one well-designed call over several chained ones. If work splits into independent parts, run calls with `Promise.all`.
   - Never call the LLM from the client.
6. Fill sections 1 and 2 of `docs/DECISIONS.md` now.

## Phase 2: Build the core path end to end

Stack: Next.js App Router, TypeScript, Tailwind, API routes in the same app, zod. In-memory store unless persistence is required by the problem.

Build in this order, running the app after each step:
1. Types and zod schemas in `lib/schemas.ts`.
2. Business logic as pure functions in `lib/` (no framework code inside).
3. API routes: thin handlers using the existing helpers. Pattern for every route:
   ```ts
   export async function POST(req: Request) {
     const limit = rateLimit(clientKey(req, "route-name"));
     if (!limit.allowed) return fail(429, "rate_limited", `Try again in ${limit.retryAfterSec}s`);
     const { data, error } = await parseBody(req, InputSchema);
     if (error) return error;
     try { return ok(await doTheWork(data)); } catch (err) { return handleError(err); }
   }
   ```
   `ok`, `fail`, `parseBody`, `handleError` are in `lib/api.ts`; `rateLimit`, `clientKey` in `lib/rate-limit.ts`. Add `export const runtime = "nodejs"` to routes that call the LLM.
4. UI, following the UI spec below.

## UI spec: top-notch, minimal, instant

Visual system (set once in `app/globals.css` and `app/layout.tsx`):
- Font: Inter via `next/font/google`, `antialiased`. Sizes: `text-sm`, `text-base`, `text-2xl` only. Weights 400 and 600.
- Palette: neutral `zinc` for everything, plus ONE accent used only for the primary action, focus rings and the key result (default: `indigo-600`, hover `indigo-500`). Background `white`, surfaces `zinc-50`, borders `zinc-200`, text `zinc-900` and `zinc-500`. Score colours: `emerald-600` good, `amber-500` medium, `rose-600` poor.
- Layout: single centered column `max-w-3xl mx-auto px-4 py-12`; cards `rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm`; 8px spacing scale; generous whitespace.
- Header: product name and a one-line value proposition. No navigation, no footer clutter.
- The key result is the visual hero: large number or badge in the accent/score colour, then short scannable reasons as a list. No walls of text.
- Motion: only `transition-colors` and a subtle fade-in on results (150-200ms). No heavy animation libraries, no component libraries.
- Set `<title>` and a meaningful `metadata.description` named after the product, not the task.

Speed (it must feel instant):
- Server Components by default; only the interactive form is a client component. No state libraries, no data-fetching libraries; plain `fetch`.
- On click: disable the button and show a spinner within one frame; show a skeleton in the exact shape of the result so the layout never jumps.
- Cancel stale requests with `AbortController` when the user submits again.
- Keep the last successful result on screen while re-running; replace it when the new one arrives.
- Client-side validation (required, max length with a live character counter) before any request.
- Keyboard: Cmd/Ctrl+Enter submits. Visible focus rings (`focus-visible:ring-2 ring-indigo-600`).
- "Try an example" button that fills the form with realistic sample data.
- Error state: one human sentence and a Retry button; never a raw error object.

## Phase 3: Edge cases (build them in, do not leave them for review)

Handle all of these:
- Empty or whitespace-only input; input over a sensible max length (reject with a clear 400 message and a character counter in the UI).
- Malformed JSON body, missing or wrong-typed fields (400 with a field-level message).
- Unicode, emoji and non-English text.
- LLM slow, failing, rate-limited or returning bad JSON (friendly message, retry button, no crash).
- Double-submit (disable button while pending) and stale responses.
- Every async action has loading, empty, error and success states, and results are announced with aria-live.
- Labels on all inputs, keyboard navigation, visible focus rings.
- No secrets in client code; the API key is read only in `lib/llm.ts`.
- Rate limit on every expensive endpoint via `lib/rate-limit.ts`, with a 429 the UI explains.
- LLM output rendered as plain text, never as HTML.

## Phase 4: Verify

1. Run `npx tsc --noEmit` and the dev server. Fix every error.
2. Exercise each endpoint with curl: one valid request and at least three invalid ones. Send the valid request twice and confirm the second is near-instant (response cache). Paste a short summary, including the `llm_call` log lines showing tokens and latency.
3. Check every acceptance criterion and mark it in `docs/DECISIONS.md`.

## Phase 5: Update docs/DECISIONS.md

Fill in every section: design Q&A (answers short enough to say aloud), build log, where the AI got something wrong and how you caught it, edge cases handled, demo script, and what you'd do next. Write the answers in first person, as Abhishek would say them.

## Phase 6: Tailor docs/SCALE.md

Fill section 7 of `docs/SCALE.md` for this exact app: the hot endpoints, which LLM calls should move to a queue at scale, which tables and fields need indexes, what to cache in Redis, and per-request token estimates. Keep the rest of the file as the baseline plan. Target: smooth at 100k users.

## Rules throughout

- If something fails twice, simplify or stub it, note it in the build log, and move on.
- Do not add auth, deployment, or features the problem does not need.
- Keep files under ~200 lines; no dead code or stray console.logs.

When finished, reply with: what was built, how to run and demo it, assumptions made, and "Run /review next."
