# Project rules

Context: live, time-boxed build (about 40 minutes). A small, fully working demo beats an ambitious broken one.

## Stack
The folder starts with only this kit; `/kickoff` chooses the stack, records why in `docs/DECISIONS.md`, and scaffolds the app (Phase 0 of `.claude/commands/kickoff.md`). Default:
- Next.js (App Router) + TypeScript + Tailwind
- API routes in the same app (no separate server, no CORS)
- zod for all input validation
- In-memory store unless persistence is truly required (then Prisma + SQLite)
- LLM: Claude API only, through `lib/llm.ts` (`generateJSON` + a zod schema). Tiers: `fast` Haiku, `smart` Sonnet (default), `deep` Opus (rare). Prompt caching, response caching, concurrency limit, retries and usage logging are built in. Server-side only. Key from `.env.local` as `ANTHROPIC_API_KEY`; never print, log or expose it.
- Route helpers: `lib/api.ts` (`ok`, `fail`, `parseBody`, `handleError`) and `lib/rate-limit.ts`. Use them in every route; do not rewrite them.
- UI: Inter, zinc neutrals + one indigo accent, no component or animation libraries, Server Components by default. Full spec in `.claude/commands/kickoff.md`.

## Working rules
- Core path first: one input -> one API call -> one result on screen, working end to end.
- Run `npx tsc --noEmit` and the dev server after each meaningful change.
- If something fails twice, simplify or stub it and record it in the build log.
- No auth, deployment or features the problem does not need.
- Keep logic in `lib/`, handlers and components thin; files under ~200 lines.

## Decisions doc (always maintained)
`docs/DECISIONS.md` is a living document. After every significant decision, fix or change:
- add or update the matching Q&A in section 3 (first person, short enough to say aloud),
- append a row to the build log in section 4,
- keep the demo script in section 7 accurate to the current app.

## Scale target
Design every choice to work smoothly at 100k users. `docs/SCALE.md` holds the infrastructure plan; keep section 7 accurate to this app.

## Commands
- `/kickoff <problem>`: builds the whole project in one pass, with edge cases, and fills the decisions doc.
- `/review`: runs all 12 review agents in parallel, then `review-resolver` analyses every finding and fixes them in one verified pass.

## Agents
Reviewers (read-only, never edit):
- Opus (deep reasoning, highest stakes): correctness, security-auditor, scalability, llm-usage
- Sonnet (judgement on design): error-handling, api-design, data-model, ui-ux, edge-case-hunter
- Haiku (checklist-style, fast and cheap): accessibility, maintainability, test-coverage

Resolver (Opus, the only agent that edits during review): review-resolver. It validates findings, merges duplicates, fixes by root cause in one batch per file, verifies, and updates docs/DECISIONS.md.
