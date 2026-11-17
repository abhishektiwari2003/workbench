// POST /api/jobs/refresh -> refetches all boards and reports added/closed jobs.
// Designed for a scheduler (Vercel Cron, EventBridge), which sends CRON_SECRET as a Bearer token.
// Fails closed in production when CRON_SECRET is not configured; open only in local dev.
import { createHash, timingSafeEqual } from "node:crypto";
import { fail, handleError, ok } from "@/lib/api";
import { refreshJobs } from "@/lib/boards";
import { clientKey, LIMITS, limitOr429 } from "@/lib/rate-limit";

function sameToken(given: string, expected: string): boolean {
  // Hash first so lengths match; timingSafeEqual avoids leaking the secret through response timing.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return fail(503, "not_configured", "Refresh is disabled until CRON_SECRET is set.");
  }
  if (secret && !sameToken(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return fail(401, "unauthorized", "Missing or invalid scheduler token.");
  }
  const limited = limitOr429(clientKey(req, "jobs-refresh"), LIMITS.jobsRefresh, "Refresh already ran.");
  if (limited) return limited;
  try {
    return ok(await refreshJobs());
  } catch (err) {
    return handleError(err);
  }
}
