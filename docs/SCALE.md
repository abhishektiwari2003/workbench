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

**Shape of the load.** Job data is shared and small: about 3,300 jobs and ~20 MB normalised, the same for every user. Only the per-candidate LLM scoring grows with users. So the plan is to make job ingest a scheduled background job, and to make matching cheap, queued and cached.

**Measured per-request cost and tokens (POST /api/match, sample resume):**

| Call | Model | Input tok | Output tok | Latency | Cost |
|---|---|---|---|---|---|
| Resume → profile (1 call) | Haiku 5.5, effort low | ~1,000 | ~500 | ~2.5s (parallel with board load) | ~$0.0004 |
| Score 20 jobs (4 calls × 5 jobs) | Sonnet 5.5, effort low | ~3,400 each | ~800 each | ~6-8s (parallel) | ~$0.060 |
| **Total per candidate** | | **~15k** | **~3.7k** | **~9-10s** | **~$0.06** (repeat resume: $0) |

At 100k MAU × 2 searches/month = 200k searches ≈ **$12k/month** before the optimisations below, and roughly $4-6k after them.

**Peak LLM load:** 30k DAU × 1 search/day ≈ 0.35 searches/s on average, ~3.5/s at peak = ~17 Claude calls/s and ~50k input tokens/s on Sonnet. That needs a raised Anthropic rate-limit tier before launch, plus the queue below.

**Hot endpoints:**

| Endpoint | Heat | At scale |
|---|---|---|
| `POST /api/match` | Expensive (5 LLM calls, ~10s) | Return `202 {id}` right away and enqueue (SQS/BullMQ); workers run the pipeline; UI polls `GET /api/matches/:id` or listens over SSE. Per-user and per-IP quotas in Redis |
| `GET /api/matches/:id` | Read-heavy, cheap | Redis first, Postgres fallback; cacheable per id |
| `GET /api/jobs` | Every page load | Serve from Redis/in-process snapshot; never triggers a board fetch on the request path |
| `POST /api/resume` | CPU (PDF parse), bursty | Fine inline up to 5 MB; move to a worker if p95 climbs |
| `POST /api/jobs/refresh` | Scheduler only (every 15-30 min) | Becomes a cron worker; nothing user-facing calls it |

**What moves to a queue / batch:**
1. **Scoring calls**: queued per candidate, worker concurrency sized to the Anthropic tier.
2. **Job ingest**: a cron worker fetches the 10 boards, diffs them, writes to Postgres and publishes a versioned snapshot to Redis/S3. App instances load the snapshot into memory (20 MB) when the version changes. Today every instance fetches the boards itself; that's fine for one instance, wasteful for 12.
3. **Job digests (biggest cost lever)**: on ingest, Haiku extracts each *new or changed* job's must-haves into ~150 tokens through the **Batch API (50% off)**. That's once per job, shared by every candidate. Scoring input drops from ~1,400 chars of raw text per job to the digest, so per-candidate cost falls roughly 2-3x.
4. **New-job alerts**: after each refresh, run only *new* jobs through the free prefilter against saved profiles, and score just the hits, in batch.

**Tables and indexes (Postgres):**

```
jobs(id text pk "gh:stripe:123", company, title, location, remote bool, department, url,
     description text, digest jsonb, content_hash, first_seen_at, last_seen_at, closed_at null)
  idx: (closed_at) WHERE closed_at IS NULL     -- the live job set
       (company), (first_seen_at)              -- "new since my last visit"
profiles(id uuid pk, resume_sha256 unique, profile jsonb, created_at)   -- no raw resume stored
match_runs(id uuid pk, profile_id fk, created_at, cost_usd numeric, stats jsonb)
  idx: (profile_id, created_at desc)
matches(run_id fk, job_id fk, score smallint, reasons jsonb, gaps jsonb, pk(run_id, job_id))
  idx: (job_id)                                -- flag/notify when a job closes
```

**Redis:**
- `jobs:snapshot:<version>`: the normalised live job set, plus `jobs:current` pointing at it.
- `llm:<sha256(model+system+input)>`: the response cache that `lib/llm.ts` already keys this way. Swap the Map for Redis.
- `profile:<resume_sha256>`: re-uploading the same resume skips Haiku.
- `score:<profile_hash>:<job_id>:<content_hash>`: re-runs and "check for new jobs" only pay for jobs not scored before.
- `match:<id>`: saved results with a 7-day TTL (Postgres is the durable copy).
- `rl:<route>:<ip|user>`: the rate limiter, same interface as `lib/rate-limit.ts`.

**Already in place in the code (single instance):** the job snapshot is served stale-while-revalidate, so no user request waits on a board refetch after warm-up; `runMatch` has a 45s overall deadline and is single-flight per resume hash (concurrent duplicates share one run); the LLM wait queue is capped at 100 and fails fast as "overloaded"; `/api/match` has a per-instance global ceiling (60/min) on top of the per-IP limit, because IP headers can be spoofed; request bodies are capped while streaming. The prefilter costs about 70ms of CPU per search on the real 3,269-job set; a per-job token index at ingest is the next step if that shows up in p99.

**What breaks first here:** the Anthropic tokens-per-minute limit on Sonnet at peak, then the cost line. The fixes, in order: queue + concurrency cap, the score cache, job digests, then measuring whether Haiku can do a first-pass rerank of 40 → 20 without hurting the eval.

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
