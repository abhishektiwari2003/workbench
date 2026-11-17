// Server-side auth for route handlers. The proxy only redirects pages; every API checks the session
// itself and answers 401 JSON (Clerk's auth.protect() would answer 404 to a fetch).
import { auth } from "@clerk/nextjs/server";
import { AppError } from "./api";

export async function requireUser(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AppError("Sign in to continue.", 401, "unauthorized");
  return userId;
}

/**
 * /ops shows platform-wide spend and usage: only users in OPS_USER_IDS (comma-separated Clerk ids).
 * Without the list, any signed-in user in local dev (the demo) and nobody in production (fails closed).
 */
export async function requireOps(): Promise<string> {
  const userId = await requireUser();
  const allow = (process.env.OPS_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const permitted = allow.length ? allow.includes(userId) : process.env.NODE_ENV !== "production";
  if (!permitted) throw new AppError("You don't have access to the ops dashboard.", 403, "forbidden");
  return userId;
}

/** Rate-limit key per signed-in user (IP-based keys are spoofable and shared behind NAT). */
export function userKey(userId: string, route: string): string {
  return `${route}:u:${userId}`;
}
