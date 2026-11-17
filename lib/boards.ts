// Fetches and normalises open jobs from the 10 public boards.
// One shared in-memory snapshot with a TTL and single-flight loading, so N users cost one fetch.
// Per-board progress is published as boards settle, so a live UI can tick each one off.
import { z } from "zod";
import { AppError } from "./api";
import { fromAshby, fromGreenhouse } from "./board-parse";
import { recordBoard } from "./metrics";
import type { BoardStatus, Job } from "./types";

import { BOARDS, type Board } from "./board-list";
import { singleton } from "./singleton";

export { BOARDS };

const TTL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const Payload = z.object({ jobs: z.array(z.unknown()) });

// Dev-only fault injection to demo graceful degradation, e.g. SIMULATE_BOARD_FAILURE=linear. Ignored in production.
function simulatedFailure(slug: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.SIMULATE_BOARD_FAILURE ?? "").toLowerCase().split(",").includes(slug);
}

async function fetchBoard(b: Board): Promise<Job[]> {
  if (simulatedFailure(b.slug)) throw new Error(`${b.company} board failure (simulated)`);
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

const state = singleton("boards", () => ({
  snapshot: null as Snapshot | null,
  inflight: null as Promise<Snapshot> | null,
  progress: [] as BoardStatus[], // boards settled so far in the in-flight load
  listeners: new Set<(b: BoardStatus) => void>(),
}));

async function loadBoard(b: Board, previous: Snapshot | null): Promise<{ status: BoardStatus; jobs: Job[] }> {
  const started = Date.now();
  let out: { status: BoardStatus; jobs: Job[] };
  try {
    const jobs = await fetchBoard(b);
    out = { status: { company: b.company, ok: true, count: jobs.length, ms: Date.now() - started }, jobs };
  } catch (err) {
    console.warn(JSON.stringify({ evt: "board_fetch_failed", company: b.company, error: String(err) }));
    // A failed board keeps its last good jobs (marked stale) rather than vanishing from results.
    const kept = previous?.jobs.filter((j) => j.company === b.company) ?? [];
    out = { status: { company: b.company, ok: false, count: kept.length, ms: Date.now() - started, stale: kept.length > 0 }, jobs: kept };
  }
  state.progress.push(out.status);
  recordBoard(out.status);
  for (const l of state.listeners) l(out.status);
  return out;
}

async function loadAll(previous: Snapshot | null): Promise<Snapshot> {
  state.progress = [];
  const loaded = await Promise.all(BOARDS.map((b) => loadBoard(b, previous)));
  const jobs = loaded.flatMap((l) => l.jobs);
  if (jobs.length === 0) {
    throw new AppError("The job boards aren't responding right now. Please try again in a minute.", 503, "boards_unavailable");
  }
  return { jobs, byId: new Map(jobs.map((j) => [j.id, j])), boards: loaded.map((l) => l.status), fetchedAt: Date.now() };
}

function load(): Promise<Snapshot> {
  state.inflight ??= loadAll(state.snapshot)
    .then((s) => (state.snapshot = s))
    .finally(() => (state.inflight = null));
  return state.inflight;
}

/**
 * Cached snapshot of every open job. Concurrent callers share one in-flight load.
 * Past the TTL it serves the old snapshot and refreshes in the background, so no user waits on a refetch.
 * `onBoard` receives each board's status: immediately from the snapshot, or live as boards settle.
 */
export async function getJobs(opts: { force?: boolean; onBoard?: (b: BoardStatus) => void } = {}): Promise<Snapshot> {
  const { force = false, onBoard } = opts;
  const current = state.snapshot;
  if (!force && current) {
    if (Date.now() - current.fetchedAt >= TTL_MS) load().catch(() => {}); // logged per board in loadBoard
    current.boards.forEach((b) => onBoard?.(b));
    return current;
  }
  const p = load();
  if (onBoard) {
    state.progress.forEach(onBoard); // boards that already settled before this caller joined
    state.listeners.add(onBoard);
    p.finally(() => state.listeners.delete(onBoard)).catch(() => {});
  }
  return p;
}

/** Current snapshot without triggering a fetch. */
export function peekJobs(): Snapshot | null {
  return state.snapshot;
}

/** Forces a refetch and reports what changed. Safe to call from a scheduler. */
export async function refreshJobs() {
  const before = state.snapshot;
  const after = await getJobs({ force: true });
  const added = before ? after.jobs.filter((j) => !before.byId.has(j.id)) : [];
  const closed = before ? before.jobs.filter((j) => !after.byId.has(j.id)) : [];
  return { before, after, added, closed };
}
