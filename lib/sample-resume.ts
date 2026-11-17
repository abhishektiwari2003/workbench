// Realistic sample used by the "Try an example" button and the curl checks.
export const SAMPLE_RESUME = `Priya Raman
San Francisco, CA · open to remote · priya.raman@example.com

SUMMARY
Senior backend engineer with 7 years building payment and money-movement systems. I design reliable distributed services in Go and Python, own them in production, and mentor engineers.

EXPERIENCE
Senior Software Engineer, Payments Platform — Brex (2021–present)
- Led the redesign of the card authorization service in Go; p99 latency down from 180ms to 45ms at 4k requests/second.
- Built an idempotent ledger on PostgreSQL and Kafka that reconciles $2B/month with zero unexplained breaks.
- Introduced a Kubernetes-based canary deploy pipeline; incident rate down 40%.
- Mentored 4 engineers; ran the payments on-call rotation and incident reviews.

Software Engineer — Plaid (2018–2021)
- Built bank-data ingestion pipelines in Python processing 30M transactions/day.
- Shipped a gRPC API gateway with rate limiting and per-client quotas used by 2,000+ fintech customers.
- Moved batch jobs to AWS (ECS, SQS, DynamoDB), cutting infrastructure cost 35%.

SKILLS
Go, Python, PostgreSQL, Kafka, Kubernetes, AWS, gRPC, Redis, distributed systems, payments, ledgers, API design, observability (Datadog, OpenTelemetry)

EDUCATION
B.S. Computer Science, University of California, Berkeley (2018)`;
