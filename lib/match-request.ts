// Shared front door for POST /api/match and /api/match/stream: session, per-user rate limit, global
// ceiling, validation, daily quota (cache hits are free), and the user's feedback-based ranking.
import { fail, handleError, parseBody } from "./api";
import { requireUser, userKey } from "./auth";
import { nudgeFrom, prefsKeyFrom } from "./feedback";
import { isCachedRun, type RunOptions } from "./pipeline/run";
import { LIMITS, limitOr429, rateLimit } from "./rate-limit";
import { MatchRequestSchema } from "./schemas";
import { DAILY_RUNS, quotaOf, votesOf } from "./users";

type Prepared = { error: Response } | { error?: never; userId: string; resumeText: string; opts: RunOptions };

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
  if (!isCachedRun(data.resumeText, prefsKey) && quotaOf(userId).remaining === 0) {
    const res = fail(
      429,
      "quota_exceeded",
      `You've used your ${DAILY_RUNS} new searches for today. Re-running a search you've already done is free; new ones reset at midnight UTC.`,
    );
    res.headers.set("retry-after", String(secondsToUtcMidnight()));
    return { error: res };
  }
  return {
    userId,
    resumeText: data.resumeText,
    opts: { prefsKey, nudge: nudgeFrom(votes), feedbackCount: votes.size, ownerId: userId },
  };
}
