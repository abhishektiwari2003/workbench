import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import SiteHeader from "@/components/SiteHeader";

const SAMPLE_PATH = "/dashboard?sample=1";
const primary =
  "inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2";
const secondary =
  "inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600";

const FUNNEL = [
  { label: "Open roles read", value: "~3,300", note: "10 company boards, refreshed every 30 min", width: "100%" },
  { label: "Pre-filtered in code", value: "40", note: "title, skills, level and location · free", width: "80%" },
  { label: "Scored by Haiku", value: "40", note: "with skill, seniority and domain sub-scores", width: "60%" },
  { label: "Explained by Sonnet", value: "≤10", note: "the ones worth your time, with reasons and gaps", width: "40%" },
];

const FEATURES = [
  { title: "Explainable", body: "Every match shows why it fits, what's missing, and a score breakdown for skills, seniority, location and domain." },
  { title: "Honest about cost", body: "Each search shows what it cost to compute, about 3 cents. Re-running a search you've done is free." },
  { title: "Location that's true", body: "Remote, hybrid and on-site come from the boards' own fields. India-based? India and remote-anywhere roles rank first." },
  { title: "Career copilot", body: "Resume coach, tailored bullets, outreach notes and interview prep. Runs only when you click, cost shown per click." },
];

function SampleCta() {
  return (
    <>
      <Show when="signed-in">
        <Link href={SAMPLE_PATH} className={primary}>
          Try with sample resume
        </Link>
      </Show>
      <Show when="signed-out">
        <Link href={`/sign-up?redirect_url=${encodeURIComponent(SAMPLE_PATH)}`} className={primary}>
          Try with sample resume
        </Link>
      </Show>
    </>
  );
}

export default function Landing() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-12">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Only the jobs worth applying to.</h1>
          <p className="mt-2 max-w-2xl text-base text-zinc-500">
            Upload your resume. CoCareer reads every open role at Stripe, OpenAI, Databricks and 7 more, and shows only your strong
            matches, each with the reasons it fits and the gaps to close.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Suspense fallback={<Link href={SAMPLE_PATH} className={primary}>Try with sample resume</Link>}>
              <SampleCta />
            </Suspense>
            <Link href="/dashboard" className={secondary}>
              Use my resume
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="mt-12 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 id="how" className="text-base font-semibold">How a search works</h2>
          <ol className="mt-4 space-y-3">
            {FUNNEL.map((s) => (
              <li key={s.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_1fr_4rem]">
                <span className="font-semibold">{s.label}</span>
                <span className="order-3 col-span-2 block h-2 sm:order-none sm:col-span-1" aria-hidden>
                  <span className="block h-full rounded-full bg-indigo-600/80" style={{ width: s.width }} />
                </span>
                <span className="text-right font-semibold tabular-nums">{s.value}</span>
                <span className="order-4 col-span-2 text-zinc-500 sm:col-span-3 sm:col-start-2">{s.note}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Features" className="mt-8 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
              <h3 className="text-base font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-zinc-500">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
