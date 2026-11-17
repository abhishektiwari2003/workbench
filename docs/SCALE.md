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

_(filled at kickoff for the app that was built: which endpoints are hot, which LLM calls go async, which tables need indexes, what gets cached)_

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
