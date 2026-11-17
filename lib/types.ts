// Domain types shared by the server pipeline and the UI. No runtime code here.

export type Workplace = "remote" | "hybrid" | "onsite" | "unknown";

export type Job = {
  id: string; // "<board>:<company>:<native id>", unique across boards
  company: string;
  title: string;
  location: string; // human text as the board shows it
  workplace: Workplace; // from structured provider fields where they exist (Ashby workplaceType)
  countries: string[]; // normalised, e.g. ["India"], ["United States"]
  regions: string[]; // e.g. ["APAC"]; for remote roles, where they may be done from
  remoteGlobal: boolean; // remote from anywhere
  department: string;
  url: string;
  postedAt?: string; // ISO; Greenhouse first_published, Ashby publishedAt
  description: string; // plain text, capped
  contentHash: string; // changes when the posting changes (job-level caches key on it)
};
export type JobSummary = Omit<Job, "description" | "contentHash">;

export type LocationFit = { score: number; label: string; indiaFriendly: boolean };

export type Breakdown = { skills: number; seniority: number; location: number; domain: number };

export type Tier = "strong" | "good" | "closest";

export type ScoredJob = {
  job: JobSummary;
  score: number; // final 0-100 (Sonnet-calibrated)
  tier: Tier;
  breakdown: Breakdown;
  reasons: string[];
  gaps: string[];
  locationFit: LocationFit;
};

export type BoardStatus = { company: string; ok: boolean; count: number; ms?: number; stale?: boolean };

export type Stage = "profile" | "score" | "explain" | "digest" | "copilot" | "quality" | "refresh";

export type MatchCost = {
  computeUsd: number; // what this result cost to compute, even when served from cache
  spentUsd: number; // what this request actually spent (0 on a cache hit)
  calls: number;
  inputTokens: number;
  outputTokens: number;
  byStage: Partial<Record<Stage, number>>; // compute USD per stage
};

export type Funnel = { scanned: number; prefiltered: number; scored: number; explained: number };

export type ProfileSummary = {
  headline: string;
  seniority: string;
  yearsExperience: number;
  country: string | null;
  targetTitles: string[];
  skills: string[];
  openToRemote: boolean;
};

export type MatchResult = {
  id: string;
  createdAt: string;
  servedFromCache: boolean;
  profile: ProfileSummary;
  stats: { jobsScanned: number; boards: BoardStatus[]; unscored: number; ms: number };
  funnel: Funnel;
  matches: ScoredJob[]; // ordered: strong, then good (or closest when nothing qualifies)
  cost: MatchCost;
  feedbackCount?: number; // ratings that nudged this ranking
  digests?: { cached: number; computed: number }; // shared job-digest cache use for this run
};

/** Progress events streamed to the browser while a match runs. */
export type PipelineEvent =
  | { type: "cached"; computedAt: string } // replaying a stored run: nothing is being spent
  | { type: "board"; board: BoardStatus }
  | { type: "digest"; cached: number; computed: number } // shared job-level cache hits for the shortlist
  | { type: "stage"; stage: keyof Funnel; count: number; done: boolean }
  | { type: "cost"; stage: Stage; stageUsd: number; totalUsd: number; cached: boolean }
  | { type: "result"; result: MatchResult }
  | { type: "error"; code: string; message: string };
