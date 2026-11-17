// Pure filter and sort logic for the results list (client-side; no refetch, no LLM).
import type { ScoredJob } from "./types";

export type Filters = {
  companies: string[]; // empty = all
  tier: "all" | "strong" | "good";
  workplace: "any" | "remote" | "hybrid" | "office"; // "office" = on-site or not stated
  indiaFriendly: boolean;
  sort: "score" | "newest";
};

export const DEFAULT_FILTERS: Filters = { companies: [], tier: "all", workplace: "any", indiaFriendly: false, sort: "score" };

export function isFiltered(f: Filters): boolean {
  return f.companies.length > 0 || f.tier !== "all" || f.workplace !== "any" || f.indiaFriendly;
}

function matchesWorkplace(m: ScoredJob, w: Filters["workplace"]): boolean {
  if (w === "any") return true;
  if (w === "office") return m.job.workplace === "onsite" || m.job.workplace === "unknown";
  return m.job.workplace === w;
}

export function applyFilters(matches: ScoredJob[], f: Filters): ScoredJob[] {
  const out = matches.filter(
    (m) =>
      (f.companies.length === 0 || f.companies.includes(m.job.company)) &&
      (f.tier === "all" || m.tier === f.tier) &&
      matchesWorkplace(m, f.workplace) &&
      (!f.indiaFriendly || m.locationFit.indiaFriendly),
  );
  if (f.sort === "newest") {
    const t = (m: ScoredJob) => (m.job.postedAt ? Date.parse(m.job.postedAt) || 0 : 0);
    return [...out].sort((a, b) => t(b) - t(a));
  }
  return out; // already ordered by tier then score (with the user's feedback as tie-break)
}

export function companiesIn(matches: ScoredJob[]): string[] {
  return [...new Set(matches.map((m) => m.job.company))].sort();
}

export function postedAgo(iso: string | undefined): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return null;
  return days === 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`;
}
