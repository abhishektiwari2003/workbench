# CoCareer

Upload a resume and see only the jobs that are a strong match, from 10 company boards (Stripe, Databricks, Airbnb, Duolingo, Discord, OpenAI, Ramp, Notion, Supabase, Linear), each with the reasons it fits and its main gap.

```bash
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

Pipeline: resume → Haiku profile → free prefilter over ~3,300 jobs → top 20 scored by Sonnet (4 parallel calls) → matches ≥ 75. About 10s and $0.06 per candidate.

Scheduled refresh: `POST /api/jobs/refresh` (send `Authorization: Bearer $CRON_SECRET` if set).

Design decisions: `docs/DECISIONS.md`. Scale plan: `docs/SCALE.md`.
