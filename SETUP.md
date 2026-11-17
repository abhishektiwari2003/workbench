# Setup Guide

`/kickoff` chooses the tech stack and scaffolds the project itself. Your setup is just: empty folder, unzip, API key, check agents.

## A. Quick checks (Mac, once)

| Need | Check |
|---|---|
| Node.js 20 or newer | `node -v` |
| Claude Code in VS Code | Claude icon in the sidebar, signed in |
| Anthropic API key | console.anthropic.com -> API Keys, with some credit |

## B. Set up the folder (about 2 minutes)

```bash
mkdir ~/workbench && cd ~/workbench
unzip ~/Downloads/claude-agent-kit.zip -d .
cp .env.example .env.local
open -e .env.local      # paste your key after ANTHROPIC_API_KEY=, save, close
code .
```

The folder should now contain:

```
.claude/agents/    13 agents (12 reviewers + review-resolver)
.claude/commands/  kickoff.md, review.md
lib/               llm.ts, api.ts, rate-limit.ts
docs/              DECISIONS.md, SCALE.md
CLAUDE.md
.env.example, .env.local
```

To see hidden files in Finder: Cmd+Shift+. (period).

## C. Check the agents (1 minute)

In the Claude Code panel in VS Code:
1. Type `/agents` -> 13 agents are listed: accessibility-reviewer, api-design-reviewer, correctness-reviewer, data-model-reviewer, edge-case-hunter, error-handling-reviewer, llm-usage-reviewer, maintainability-reviewer, review-resolver, scalability-reviewer, security-auditor, test-coverage-reviewer, ui-ux-reviewer.
2. Type `/` -> `kickoff` and `review` appear.
3. If nothing shows: make sure VS Code opened the `workbench` folder itself (not its parent), then Cmd+Shift+P -> "Developer: Reload Window".

Optional, saves 1-2 minutes live: warm the npm cache now so scaffolding is fast during the session:
```bash
npx create-next-app@latest --version
```

## D. During the session

1. Read the problem aloud and confirm 1-2 assumptions.
2. `/kickoff <paste the problem>`. It decides the stack, scaffolds, plans, and builds. Narrate the stack choice and plan as they appear.
3. Test it yourself in the browser: happy path, empty input, the example button.
4. `/review`. The 12 reviewers run in parallel, then review-resolver fixes everything in one pass. Narrate what each group checks and the resolver's fix plan.
5. Demo with section 7 of `docs/DECISIONS.md`. Answer design questions from its section 3 and infrastructure questions from `docs/SCALE.md` section 8.
6. Close with "what I'd do next" from `docs/DECISIONS.md` section 8.

If time is short after the build, run a smaller review: "run correctness-reviewer, security-auditor and edge-case-hunter in parallel, then review-resolver with their reports."

## E. Screen-share hygiene

- Close chat apps, email and unrelated tabs. Turn on Do Not Disturb.
- Have open: VS Code (Claude Code panel + terminal) and one browser tab for localhost:3000.
- Never open `.env.local` on screen.
- Increase VS Code font size (Cmd + =).

## F. Troubleshooting

| Symptom | Fix |
|---|---|
| `/agents` shows nothing | VS Code must be opened on the folder that contains `.claude/`; reload the window |
| Scaffolding fails | Ask Claude Code: "scaffold Next.js per Phase 0 step 3 again and show the error" |
| `ANTHROPIC_API_KEY is not set` | Key must be in `.env.local`; restart the dev server |
| 401 from the API | Key copied wrongly or revoked; create a new one |
| 404 model not found | Set `ANTHROPIC_MODEL*` in `.env.local` to model IDs your account has |
| 429 / 529 from the API | Rate limit or overload; the helper retries, otherwise wait and retry |
| Port 3000 busy | `npx kill-port 3000` or use the port Next prints |
| Type errors | Ask Claude Code: "run npx tsc --noEmit and fix every error" |

## G. Model choices (why)

| Where | Model | Reason |
|---|---|---|
| Correctness, security, scalability, LLM-usage reviewers | Opus | Highest-stakes reasoning; misses here are costly |
| Error-handling, API, data-model, UI/UX, edge-case reviewers | Sonnet | Strong judgement, faster and cheaper than Opus |
| Accessibility, maintainability, test-coverage reviewers | Haiku | Checklist-style work; fastest and cheapest |
| review-resolver | Opus | Must judge 12 reports at once, reject false positives, fix by root cause without breaking anything |
| App: extraction, classification | Haiku (`fast`) | Cheap, low latency |
| App: scoring with reasons, summaries | Sonnet (`smart`) | Best quality per rupee |
| App: complex multi-step reasoning | Opus (`deep`) | Only when Sonnet is not enough |
