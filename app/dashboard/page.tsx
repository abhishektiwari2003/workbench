import MatchApp from "@/components/MatchApp";
import SiteHeader from "@/components/SiteHeader";

export default function DashboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-12 pt-8">
        <MatchApp />
      </main>
    </>
  );
}
