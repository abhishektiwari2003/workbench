# Engineering Decisions

> Maintained by Claude during the build. Every significant decision is recorded as a question with a short, clear answer (under 30 seconds).

## 1. Problem

**Problem statement (verbatim):**

_(filled at kickoff)_

**Restated in one paragraph:**

**Assumptions made:**
-

**Open questions to confirm with stakeholders:**
-

**Acceptance criteria:**
- [ ]

## 2. Architecture

```
(ASCII diagram: UI -> API route -> service -> Claude API / store)
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | | |
| API | | |
| Data | | |
| LLM | | |

**Data model:**

```ts
```

**API contract:**

| Method | Path | Request | Response | Errors |
|---|---|---|---|---|

## 3. Design Q&A

_Format: question, then the answer exactly as I would say it._

**Q: Why did you choose this stack?**
A:

**Q: Why this data model?**
A:

**Q: How does this handle 10x and 100x more users?**
A:

**Q: What happens when the Claude API is slow, down or returns bad output?**
A:

**Q: How do you protect against prompt injection and bad input?**
A:

**Q: Which model did you use, and what does each request cost?**
A:

**Q: What did you deliberately leave out, and why?**
A:

## 4. How I Built It

**Workflow:** one kickoff prompt builds the core flow end to end with Claude Code, then 12 specialist review agents check the build in parallel (correctness, error handling, API design, data model, scalability, security, edge cases, LLM usage, UI/UX, accessibility, maintainability, test coverage). A resolver agent on Opus then validates every finding, merges duplicates, fixes them by root cause in one verified pass, and records the rest as documented tradeoffs.

**Build log:**

| Step | What was built | Notes |
|---|---|---|

**Where the AI got it wrong and how it was caught:**
-

## 5. Edge Cases Handled

| Case | Behaviour |
|---|---|

## 6. Review Findings

**Fixed:**

| Agent | Issue | Fix |
|---|---|---|

**Known tradeoffs (talking points, not fixed):**

| Agent | Issue | What I'd do with more time |
|---|---|---|

## 7. Demo Script

1. **Setup:** `npm run dev`, open http://localhost:3000
2. **Happy path:**
3. **Edge case to show:**
4. **Error handling to show:**
5. **Code to point at:**

**60-second walkthrough:**

## 8. What I'd Do Next

1.
2.
3.
