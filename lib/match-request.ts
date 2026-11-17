// Shared front door for POST /api/match and /api/match/stream: session, per-user rate limit, global
// ceiling, daily spend budget, validation, daily quota (free runs skip it), and the user's feedback ranking.
import { fail, handleError, parseBody } from "./api";
import { requireUser, userKey } from "./auth";
import { nudgeFrom, prefsKeyFrom } from "./feedback";
import { spentTodayUsd } from "./metrics";
import { isFreeRun, runMatch, type RunOptions } from "./pipeline/run";
import { LIMITS, limitOr429, rateLimit } from "./rate-limit";
import { MatchRequestSchema } from "./schemas";
import type { MatchResult } from "./types";
import { DAILY_RUNS, recordRun, refundRun, reserveRun, votesOf } from "./users";

// Platform-wide LLM spend ceiling per UTC day (per instance): open sign-up can't drain the API key.
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD) || 25;

type Ready = { userId: string; resumeText: string; opts: RunOptions; reserved: boolean };
type Prepared = { error: Response } | ({ error?: never } & Ready);

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

export async function prepareMatch(req: Request): Promise<Prepared> {
  let userId: string;
  try {
    userId = await requireUser();
  } catch (err) {
    return { error: handleError(err) };
  }
  const limited = limitOr429(userKey(userId, "match"), LIMITS.match, "You've run several searches in a row.");
  if (limited) return { error: limited };
  if (!rateLimit("match:global", LIMITS.matchGlobal).allowed) {
    return { error: fail(503, "busy", "We're handling a lot of searches right now. Please try again in a minute.") };
  }
  const { data, error } = await parseBody(req, MatchRequestSchema);
  if (error) return { error };

  const votes = votesOf(userId);
  const prefsKey = prefsKeyFrom(votes);
  const free = isFreeRun(data.resumeText, prefsKey);
  if (!free && spentTodayUsd() >= DAILY_BUDGET_USD) {
    return { error: fail(503, "busy", "We've reached today's capacity for new searches. Please try again tomorrow.") };
  }
  // Reserve the quota now, not after the run: otherwise parallel requests all pass the check.
  if (!free && !reserveRun(userId)) {
    const res = fail(
      429,
      "quota_exceeded",
      `You've used your ${DAILY_RUNS} new searches for today. Re-running a search is free while the job list is unchanged (up to 30 minutes); new ones reset at midnight UTC.`,
    );
    res.headers.set("retry-after", String(secondsToUtcMidnight()));
    return { error: res };
  }
  return {
    userId,
    resumeText: data.resumeText,
    reserved: !free,
    opts: { prefsKey, nudge: nudgeFrom(votes), feedbackCount: votes.size, ownerId: userId },
  };
}

/** Runs the search and settles quota: one search is charged only to the caller that started a paid run. */
export async function executeMatch(p: Ready, emit?: RunOptions["emit"]): Promise<MatchResult> {
  let charged = false;
  try {
    const { result, created } = await runMatch(p.resumeText, { ...p.opts, emit });
    charged = created;
    recordRun(p.userId, result);
    return result;
  } finally {
    if (p.reserved && !charged) refundRun(p.userId); // failed, cached or joined: give the search back
  }
}
