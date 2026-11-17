import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";

const link =
  "rounded-lg px-2 py-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600";

function AuthLinks() {
  return (
    <>
      <Show when="signed-in">
        <Link href="/dashboard" className={link}>
          Dashboard
        </Link>
        <Link href="/ops" className={link}>
          Ops
        </Link>
        <UserButton />
      </Show>
      <Show when="signed-out">
        <Link href="/sign-in" className={link}>
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
        >
          Get started
        </Link>
      </Show>
    </>
  );
}

/** Product name and account controls. Auth state reads the request, so it sits in Suspense (cacheComponents). */
export default function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 pt-8">
      <Link href="/" className="rounded-lg text-base font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
        CoCareer
      </Link>
      <nav className="flex h-9 items-center gap-2" aria-label="Account">
        <Suspense fallback={<span className="h-8 w-24" aria-hidden />}>
          <AuthLinks />
        </Suspense>
      </nav>
    </header>
  );
}
