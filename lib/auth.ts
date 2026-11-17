// Server-side auth for route handlers. The proxy only redirects pages; every API checks the session
// itself and answers 401 JSON (Clerk's auth.protect() would answer 404 to a fetch).
import { auth } from "@clerk/nextjs/server";
import { AppError } from "./api";

export async function requireUser(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AppError("Sign in to continue.", 401, "unauthorized");
  return userId;
}

/** Rate-limit key per signed-in user (IP-based keys are spoofable and shared behind NAT). */
export function userKey(userId: string, route: string): string {
  return `${route}:u:${userId}`;
}
