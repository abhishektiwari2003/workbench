import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";

export default function SignUpPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl justify-center px-4 py-12">
        {/* Clerk's catch-all auth routes read the request, so they render inside Suspense (cacheComponents). */}
        <Suspense fallback={<div className="h-[28rem] w-full max-w-sm animate-pulse rounded-2xl bg-zinc-100" />}>
          <SignUp />
        </Suspense>
      </main>
    </>
  );
}
