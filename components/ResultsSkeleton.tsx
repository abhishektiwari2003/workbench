import { SHORTLIST_SIZE } from "@/lib/schemas";

export default function ResultsSkeleton({ jobsTotal }: { jobsTotal: number | null }) {
  return (
    <div className="space-y-4" aria-hidden>
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="h-8 w-56 animate-pulse rounded-md bg-zinc-100" />
        <p className="mt-2 text-sm text-zinc-500">
          Reading your resume and scanning {jobsTotal ? jobsTotal.toLocaleString() : "every"} open role across 10
          companies. The closest {SHORTLIST_SIZE} get a full AI review. About 10 seconds.
        </p>
        <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-zinc-100" />
      </section>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex gap-4">
            <div className="h-12 w-12 animate-pulse rounded-xl bg-zinc-100" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-zinc-100" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-100" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-zinc-100" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
