---
description: Run all 12 review agents in parallel, then the review-resolver fixes everything in one verified pass
---

## Step 1: Review (parallel, read-only)

Make sure the dev server is running (start `npm run dev` in the background if it is not). Then launch ALL 12 of these subagents in parallel, in a single step. Give each the same short brief: "Review the current project. Read CLAUDE.md and docs/DECISIONS.md first. Report in your required format."

1. correctness-reviewer
2. error-handling-reviewer
3. api-design-reviewer
4. data-model-reviewer
5. scalability-reviewer
6. security-auditor
7. edge-case-hunter
8. llm-usage-reviewer
9. ui-ux-reviewer
10. accessibility-reviewer
11. maintainability-reviewer
12. test-coverage-reviewer

Do not edit any code during this step.

## Step 2: Hand off to the resolver

When all 12 have reported, show me a one-line count per agent (blockers / majors / minors). Then launch the **review-resolver** subagent and pass it the COMPLETE, unedited text of all 12 reports in its prompt, plus: "Analyse, fix and verify per your instructions."

Do not fix anything yourself; the resolver owns every edit.

## Step 3: Confirm

When the resolver reports back:
1. Show me its summary block as-is.
2. Run `npx tsc --noEmit` once yourself and hit the main endpoint once with curl to independently confirm the app still works.
3. If anything fails, launch review-resolver again with just the failure output.
