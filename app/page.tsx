import MatchApp from "@/components/MatchApp";

export default function Home() {
  return (
    <>
      <header className="mx-auto max-w-3xl px-4 pb-8 pt-12">
        <h1 className="text-2xl font-semibold tracking-tight">CoCareer</h1>
        <p className="mt-1 text-base text-zinc-500">
          Upload your resume. See only the jobs worth applying to at Stripe, OpenAI, Databricks and 7 more, with the
          reasons why.
        </p>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-12">
        <MatchApp />
      </main>
    </>
  );
}
