// Next.js 16 proxy (formerly middleware). Clerk reads the session on every request; pages under
// /dashboard and /ops redirect to sign-in when signed out. API routes do their own check and answer
// 401 JSON (lib/auth.ts), because auth.protect() answers 404 to fetch requests.
import { clerkMiddleware } from "@clerk/nextjs/server";

const PROTECTED_PAGES = ["/dashboard", "/ops"];

export default clerkMiddleware(
  async (auth, req) => {
    const path = req.nextUrl.pathname;
    if (PROTECTED_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
