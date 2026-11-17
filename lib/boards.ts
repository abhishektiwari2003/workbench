// Fetches and normalises open jobs from the 10 public boards.
// One shared in-memory snapshot with a TTL and single-flight loading, so N users cost one fetch.
import { z } from "zod";
import { AppError } from "./api";
import type { BoardStatus, Job } from "./schemas";
import { collapse, htmlToText } from "./text";

type Source = "greenhouse" | "ashby";
export const BOARDS: { company: string; slug: string; source: Source }[] = [
  { company: "Stripe", slug: "stripe", source: "greenhouse" },
  { company: "Databricks", slug: "databricks", source: "greenhouse" },
  { company: "Airbnb", slug: "airbnb", source: "greenhouse" },
  { company: "Duolingo", slug: "duolingo", source: "greenhouse" },
  { company: "Discord", slug: "discord", source: "greenhouse" },
  { company: "OpenAI", slug: "openai", source: "ashby" },
  { company: "Ramp", slug: "ramp", source: "ashby" },
  { company: "Notion", slug: "notion", source: "ashby" },
  { company: "Supabase", slug: "supabase", source: "ashby" },
  { company: "Linear", slug: "linear", source: "ashby" },
];

const TTL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_DESCRIPTION = 6_000;

// External payloads are validated too; a malformed job is skipped, not fatal.
// Ids are interpolated into prompts and urls into hrefs, so both are constrained.
const SafeId = z.string().regex(/^[\w-]+$/);
const HttpsUrl = z.string().regex(/^https:\/\/[^\s"<>]+$/);
const GreenhouseJob = z.object({
  id: z.union([z.number(), SafeId]),
  title: z.string(),
  absolute_url: HttpsUrl,
  location: z.object({ name: z.string().nullish() }).nullish(),
  updated_at: z.string().nullish(),
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string() })).nullish(),
});
const AshbyJob = z.object({
  id: SafeId,
  title: z.string(),
  jobUrl: HttpsUrl,
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  department: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  isListed: z.boolean().nullish(),
});
const Payload = z.object({ jobs: z.array(z.unknown()) });

function fromGreenhouse(company: string, raw: unknown): Job | null {
  const p = GreenhouseJob.safeParse(raw);
  if (!p.success) return null;
  const j = p.data;
  const location = j.location?.name?.trim() || "Unspecified";
  return {
    id: `gh:${company.toLowerCase()}:${j.id}`,
    company,
    title: j.title.trim(),
    location,
    remote: /remote/i.test(location),
    department: j.departments?.[0]?.name?.replace(/^\d+\s+/, "") ?? "",
    url: j.absolute_url,
    postedAt: j.updated_at ?? undefined,
    description: htmlToText(j.content ?? "").slice(0, MAX_DESCRIPTION),
  };
}

function fromAshby(company: string, raw: unknown): Job | null {
  const p = AshbyJob.safeParse(raw);
  if (!p.success || p.data.isListed === false) return null;
  const j = p.data;
  const extra = (j.secondaryLocations ?? []).map((l) => l.location).filter(Boolean);
  const location = [j.location, ...extra].filter(Boolean).join("; ") || "Unspecified";
  return {
    id: `ab:${company.toLowerCase()}:${j.id}`,
    company,
    title: j.title.trim(),
    location,
    remote: Boolean(j.isRemote) || j.workplaceType === "Remote" || /remote/i.test(location),
    department: j.department ?? "",
    url: j.jobUrl,
    postedAt: j.publishedAt ?? undefined,
    description: collapse(j.descriptionPlain ?? "").slice(0, MAX_DESCRIPTION),
  };
}

async function fetchBoard(b: (typeof BOARDS)[number]): Promise<Job[]> {
  const url =
    b.source === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${b.slug}/jobs?content=true`
      : `https://api.ashbyhq.com/posting-api/job-board/${b.slug}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${b.company} board returned HTTP ${res.status}`);
  const { jobs } = Payload.parse(await res.json());
  const map = b.source === "greenhouse" ? fromGreenhouse : fromAshby;
  return jobs.map((j) => map(b.company, j)).filter((j): j is Job => j !== null);
}

export type Snapshot = { jobs: Job[]; byId: Map<string, Job>; boards: BoardStatus[]; fetchedAt: number };

let snapshot: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

async function loadAll(previous: Snapshot | null): Promise<Snapshot> {
  const settled = await Promise.allSettled(BOARDS.map(fetchBoard));
  const jobs: Job[] = [];
  const boards: BoardStatus[] = settled.map((r, i) => {
    const company = BOARDS[i].company;
    if (r.status === "fulfilled") {
      jobs.push(...r.value);
      return { company, ok: true, count: r.value.length };
    }
    console.warn(JSON.stringify({ evt: "board_fetch_failed", company, error: String(r.reason) }));
    // A failed board keeps its last good jobs (marked stale) rather than vanishing from results.
    const kept = previous?.jobs.filter((j) => j.company === company) ?? [];
    jobs.push(...kept);
    return { company, ok: false, count: kept.length, stale: kept.length > 0 };
  });
  if (jobs.length === 0) {
    throw new AppError("The job boards aren't responding right now. Please try again in a minute.", 503, "boards_unavailable");
  }
  return { jobs, byId: new Map(jobs.map((j) => [j.id, j])), boards, fetchedAt: Date.now() };
}

function load(): Promise<Snapshot> {
  inflight ??= loadAll(snapshot)
    .then((s) => (snapshot = s))
    .finally(() => (inflight = null));
  return inflight;
}

/**
 * Cached snapshot of every open job. Concurrent callers share one in-flight load.
 * Past the TTL it serves the old snapshot and refreshes in the background, so no user waits on a refetch.
 */
export async function getJobs(force = false): Promise<Snapshot> {
  if (!force && snapshot) {
    if (Date.now() - snapshot.fetchedAt >= TTL_MS) load().catch(() => {}); // logged per board in loadAll
    return snapshot;
  }
  return load();
}

/** Current snapshot without triggering a fetch (used to flag closed jobs on saved results). */
export function peekJobs(): Snapshot | null {
  return snapshot;
}

/** Forces a refetch and reports what changed. Safe to call from a scheduler. */
export async function refreshJobs() {
  const before = snapshot;
  const after = await getJobs(true);
  const added = before ? after.jobs.filter((j) => !before.byId.has(j.id)).length : after.jobs.length;
  const closed = before ? before.jobs.filter((j) => !after.byId.has(j.id)).length : 0;
  return { total: after.jobs.length, added, closed, boards: after.boards, fetchedAt: new Date(after.fetchedAt).toISOString() };
}
