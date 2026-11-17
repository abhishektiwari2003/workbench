# Scale Plan: 100k Users

> Baseline plan for taking this app from a single instance to 100k users smoothly. `/kickoff` adapts section 7 to the actual app that was built.

## 1. Load model (state assumptions first, then do the maths)

| Assumption | Value | Why |
|---|---|---|
| Users | 100k monthly active, ~30k daily active | Typical 30% DAU/MAU for a career tool |
| Peak concurrency | ~5% of DAU online at peak = ~1,500 concurrent | Usage clusters in evenings and Mondays |
| Requests per active user | ~1 API request per 10s while active | Page loads, polling, actions |
| **Peak API load** | **~150-300 req/s**, design for **1,000 req/s** (3-5x headroom) | Spikes from launches, emails, press |
| LLM calls per DAU | ~5 per day = 150k/day | Core AI feature used a few times a session |
| **Peak LLM load** | avg ~2/s, peak ~20/s; at ~5s each = **~100 calls in flight** | Peak = 10x average |

Rule I use: work out average, multiply by 10 for peak, then design for 3x that.

## 2. Architecture at 100k users

```
Users (India, SEA, US)
   |
CDN + WAF (CloudFront or Vercel Edge)   <- static assets, caching, DDoS and bot protection
   |
Load balancer (ALB)
   |
Next.js app: stateless containers, autoscaling 3 -> 12   (ECS Fargate or Vercel)
   |            |                 |
   |        Redis (cache, rate limit, sessions, idempotency keys)
   |            |
   |        Queue (SQS or BullMQ) -> LLM workers (autoscale 2 -> 10) -> Claude API
   |
Postgres primary (Multi-AZ) + 1 read replica, via PgBouncer connection pooling
   |
S3 (uploads such as resumes) + daily snapshots and point-in-time recovery
```

Principles: stateless app servers, all state in Postgres/Redis/S3, slow work (LLM) off the request path, cache before compute, scale horizontally.

## 3. How many servers

| Component | Size | Count | Reasoning |
|---|---|---|---|
| App containers | 1 vCPU / 2 GB each | min 3, max 12 (autoscale at 60% CPU) | Node handles ~200-400 light I/O-bound req/s per vCPU; 1,000 req/s peak needs ~4-5, plus headroom and one per AZ |
| LLM workers | 0.5 vCPU / 1 GB each | min 2, max 10 (scale on queue depth) | Workers mostly wait on the network; each holds ~20-30 concurrent calls |
| Postgres | 2 vCPU / 8-16 GB (e.g. db.r6g.large) | 1 primary Multi-AZ + 1 read replica | 100k users is small for Postgres; replica serves dashboards and reads |
| Redis | ~1-2 GB managed | 1 primary + 1 replica | Cache, rate limits, sessions, queue |
| CDN | managed | n/a | Serves all static assets; app never serves them |

At 100k users, total is roughly 5-15 small containers plus one managed database. The bottleneck is not servers; it is LLM rate limits and cost.

## 4. Where I'd deploy it (two phases)

**Phase 1: launch to ~50k users (speed and low ops)**
- App: Vercel (autoscaling, preview deploys, edge CDN built in)
- DB: Neon or Supabase Postgres (managed, branching, pooling)
- Redis: Upstash (serverless, pay per request)
- Queue: Upstash QStash or Inngest
- Files: S3 or Cloudflare R2
- Monitoring: Sentry + Vercel analytics + structured logs
- Why: a small team ships faster with zero infra to manage; costs stay low at low traffic.

**Phase 2: ~50k-100k+ users (control and cost)**
- AWS: ECS Fargate behind an ALB, RDS Postgres Multi-AZ, ElastiCache Redis, SQS, S3, CloudFront + WAF, Secrets Manager
- Region: closest to most users, e.g. ap-south-1 (Mumbai) for India, ap-southeast-1 (Singapore) for SEA, us-east-1 for US. Start single-region, Multi-AZ.
- Infra as code: Terraform or AWS CDK. CI/CD: GitHub Actions -> build image -> deploy with rolling updates.
- Why move: predictable cost at steady load, VPC networking, fine-grained scaling of workers vs web.

## 5. LLM at scale (the real bottleneck)

- **Tiering:** Haiku for extraction/classification, Sonnet for reasoning, Opus only where needed. Most calls should not hit the top tier.
- **Caching:** Anthropic prompt caching for the static system prompt; Redis response cache keyed by hash of model + prompt + input.
- **Queue:** LLM calls go through a queue with workers so spikes become waiting, not failures. UI shows progress; result is pushed or polled.
- **Concurrency cap** per worker + global, sized to the Anthropic rate-limit tier; request a higher tier before launch.
- **Tight outputs:** compact JSON schemas and small max_tokens; output tokens drive cost and latency.
- **Batch API** for non-urgent bulk work (nightly re-scoring) at lower cost.
- **Fallbacks:** retry with backoff on 429/529; fall back to a smaller model or a cached/partial result; never a blank screen.
- **Per-user quotas** to stop abuse and runaway cost.
- **Cost formula:** monthly cost = calls/month x (input tokens x input price + output tokens x output price), reduced by cache hit rate. I'd plug in current pricing from the Anthropic pricing page and track actuals from the usage logs.

## 6. Reliability, security, operations

| Area | Plan |
|---|---|
| Availability | Multi-AZ everything, health checks, min 3 app instances, target 99.9% |
| Deploys | Rolling or blue/green, automatic rollback on failed health checks, DB migrations backward-compatible |
| Observability | Sentry errors, OpenTelemetry traces, metrics dashboards (p95 latency, error rate, queue depth, LLM tokens and cost), alerts to Slack |
| Load testing | k6 before launch: ramp to 1,000 req/s, find the first bottleneck, fix, repeat |
| Database | PgBouncer pooling, indexes on every filter, pagination everywhere, read replica, PITR backups, tested restore |
| Security | WAF + bot protection, rate limits per IP and per user, secrets in Secrets Manager, encryption at rest and in transit, least-privilege IAM, PII minimisation for resumes |
| Compliance | Data residency choice per region, data deletion on request (relevant for resumes and personal data) |
| Cost control | Autoscaling down at night, budgets and alerts, LLM cost per feature from logs |

## 7. This app specifically

**Shape of the load.** Job data is shared and small: about 3,300 jobs, ~20 MB normalised, plus one digest per job, the same for every user. Only per-candidate scoring grows with users, and repeats are free. So: shared things are computed once (board snapshot, job digests), per-candidate work is a tight funnel, and everything slow moves off the request path.

**Measured per-candidate cost (sample and India resumes, Nov 2026):**

| Stage | Model | Calls | Input / output tokens | Latency | Cost |
|---|---|---|---|---|---|
| Profile | Haiku 5.5, thinking off | 1 | ~1k / ~0.4k | ~1.5–2.5s (parallel with boards) | ~$0.0003 |
| Prefilter 3,271 → 40 | code | 0 | — | ~70ms CPU | $0 |
| Score 40 (4 × 10) | Haiku 5.5, effort low | 4 | ~22k / ~5k | ~4–6s (parallel) | ~$0.004 |
| Explain ≤10 (2 × 5) | Sonnet 5.5, effort low | 2 | ~7k / ~1.6k | ~6–7s (parallel) | ~$0.030 |
| **Fresh search (cold digests)** | | **7** | **~30k / ~7k** | **~16–20s** | **~$0.035** |
| **Fresh search (warm digests)** | | 7 | ~24k / ~5k | **~12s** | **~$0.031** |
| Repeat search | — | 0 | — | <1s replay | **$0** |
| Job digest (shared, background) | Haiku 5.5, thinking off | 1 per 5 jobs | ~3.7k / ~0.9k per call | off the request path | **$0.00015 per job** |
| Copilot click / quality check | Haiku / Sonnet | 1 | — | 2–5s | ~$0.0003–0.001 / ~$0.019 |

**Monthly projection (also live on /ops, from measured runs):** assumes 20% of searches are repeats and 30% of the catalogue changes each month.

| Candidates / month | No shared caches | With result cache + shared digests | Per candidate |
|---|---|---|---|
| 1,000 | ~$36 | ~$27 | ~$0.027 |
| 10,000 | ~$360 | ~$255 | ~$0.026 |
| 100,000 | ~$3,600 | ~$2,500 | ~$0.025 |

The shared digest cost is about $0.50 for the whole catalogue plus ~$0.15/month of churn, so per-candidate cost converges on the warm-digest variable cost as volume grows. The next lever is Batch API (50% off) for refresh and digests, then per-candidate score caching (`score:<profile>:<job>:<content_hash>`).

**Peak load:** 30k DAU × 1 search/day ≈ 0.35 searches/s average, ~3.5/s at peak = ~25 Claude calls/s (7 per search) and ~100k input tokens/s, ~25k of them on Sonnet. That needs a raised Anthropic rate-limit tier plus the queue below.

**Hot endpoints:**

| Endpoint | Heat | At scale |
|---|---|---|
| `POST /api/match/stream` | Expensive (~7 LLM calls, ~15s, SSE) | Enqueue the run (SQS/BullMQ) keyed by resume hash + feedback version; workers publish progress events to Redis pub/sub; the SSE handler subscribes, so any instance can stream any run. Same single-flight and result cache, in Redis |
| `GET /api/me`, `/api/matches/:id` | Every dashboard load | Postgres with Redis read-through; owner check in SQL |
| `POST /api/copilot`, `/api/quality` | On click, cheap | Inline is fine; response cache in Redis keyed as today |
| `GET /api/ops` | Low | Read from Prometheus/OTel instead of process memory |
| `POST /api/refresh` | Cron only (every 30 min) | Worker: fetch → diff → upsert jobs → enqueue digests for new/changed jobs → per-user re-score jobs via the Batch API |
| `GET /api/jobs` | Every page load | Versioned snapshot from Redis/S3; never fetches boards on the request path |

**What moves to a queue / batch:**
1. **Searches**: queue + workers sized to the Anthropic tier; the SSE stream reads progress from Redis.
2. **Job ingest + digests**: a cron worker digests every new or changed job at ingest (Batch API), so searches always see warm digests (≈ $0.031 and ~12s for everyone, not just the second candidate).
3. **Refresh re-scoring**: already only new jobs × users whose shortlist they'd enter; at scale each user is a batch request, results land in their "new matches" inbox, and an email/notification goes out.

**Tables and indexes (Postgres):**

```
jobs(id text pk, company, title, location, workplace, countries text[], regions text[], remote_global bool,
     department, url, posted_at timestamptz, description text, content_hash, digest jsonb,
     first_seen_at, last_seen_at, closed_at null)
  idx: (closed_at) WHERE closed_at IS NULL; (company); (posted_at); GIN(countries)   -- live set, filters, "new since"
users(id text pk /* Clerk userId */, last_seen_at, previous_visit_at)
quota(user_id, day date, used int, pk(user_id, day))                                  -- 5 new searches/day
votes(user_id, job_id, vote smallint, pk(user_id, job_id))                            -- feedback nudges
runs(id uuid pk, user_id, resume_sha256, prefs_version, profile jsonb, cost jsonb, funnel jsonb, created_at)
  idx: (user_id, created_at desc); (resume_sha256, prefs_version)
matches(run_id, job_id, score smallint, tier, breakdown jsonb, reasons jsonb, gaps jsonb, pk(run_id, job_id))
  idx: (job_id)                                                                       -- flag when a job closes
new_matches(user_id, job_id, found_at, payload jsonb, pk(user_id, job_id))            -- refresh inbox
```

**Redis:** `jobs:current` + `jobs:snapshot:<v>`; `digest:<job_id>:<content_hash>`; `llm:<sha256>` (the existing response-cache key); `result:<resume_sha256>:<prefs>:<snapshot_v>`; `run:<key>` single-flight lock + `events:<run>` pub/sub; `rl:<route>:u:<user>` and the global ceiling.

**Already in the code (single instance):** SSE progress with replay for late joiners; single-flight per resume + feedback version; result cache that reports original cost; shared digest cache computed in the background on at most 2 of 8 model slots; refresh that only re-scores new jobs; per-user quota reserved before the run and refunded on failure (atomic `INCR` on `quota:<user>:<day>` in Redis), rate limits, a global ceiling and a daily spend budget (`DAILY_BUDGET_USD`); refresh isolated per user with its own deadline; 45s pipeline deadline; LLM queue capped at 100; stale-while-revalidate board snapshot; bodies capped while streaming; in-memory stores behind small interfaces (`lib/store.ts`, `lib/users.ts`, `lib/result-cache.ts`, `lib/digests.ts`) ready to swap for Redis/Postgres.

**What breaks first here:** Anthropic tokens-per-minute on Sonnet at peak, then per-instance memory for caches. Fixes, in order: queue + concurrency cap sized to the tier, Redis-backed caches (shared across instances), digests at ingest via the Batch API, then per-candidate score caching.

## 8. Questions and answers

**Q: How would this handle 100k users?**
A: The app servers are stateless, so I scale them horizontally behind a load balancer. State lives in Postgres and Redis. Slow LLM work goes through a queue, and I cache aggressively. At 100k users the real constraints are LLM rate limits and cost, not servers.

**Q: How many servers would you need?**
A: Around 3 to 12 small app containers autoscaling on CPU, 2 to 10 LLM workers scaling on queue depth, one Postgres primary with a replica, and a small Redis. I'd size from a load test, not guess: k6 up to 1,000 requests per second.

**Q: Where would you deploy it?**
A: Phase one on Vercel with Neon and Upstash, because a small team ships fastest with no infra to run. Past roughly 50k users I'd move to AWS: ECS Fargate, RDS, ElastiCache, SQS, CloudFront, in the region closest to users, Multi-AZ.

**Q: What breaks first?**
A: LLM rate limits, then database connections. I'd fix the first with a queue, caching, model tiering and a higher rate-limit tier, and the second with PgBouncer and read replicas.

**Q: What if traffic spikes 10x in a minute?**
A: The CDN absorbs static traffic, rate limits protect the API, autoscaling adds containers, and the queue turns LLM bursts into a short wait instead of errors. The user sees a progress state, not a failure.

**Q: What if the Claude API goes down?**
A: Retries with backoff, then a fallback to a smaller model or a cached result, and a clear message with retry. Jobs stay in the queue and complete when the API recovers, so no work is lost.

**Q: How do you keep LLM costs under control?**
A: Cheapest model that meets quality, prompt caching, a response cache, tight output schemas, per-user quotas, batch processing for non-urgent work, and cost tracked per feature from token logs.

**Q: How do you know it's working in production?**
A: Dashboards for p95 latency, error rate, queue depth and LLM spend, with alerts. Sentry for errors, traces across app, queue and LLM calls.

**Q: How do you deploy without downtime?**
A: Rolling deploys with health checks and automatic rollback, and database migrations that are backward-compatible so old and new code can run side by side.

**Q: How do you handle the database at scale?**
A: Indexes on every filtered field, pagination everywhere, connection pooling, a read replica for heavy reads, and point-in-time backups with tested restores. 100k users is comfortably within one well-tuned Postgres.

**Q: How do you protect user data like resumes?**
A: Encrypted at rest and in transit, private S3 buckets with signed URLs, least-privilege access, no PII in logs or prompts beyond what's needed, and deletion on request.

**Q: Monolith or microservices?**
A: Modular monolith now: one Next.js app with clean `lib/` boundaries, plus separate workers for LLM jobs. I'd split a service out only when a team or a scaling profile needs it.
