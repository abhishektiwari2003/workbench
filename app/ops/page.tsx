import OpsDashboard from "@/components/ops/OpsDashboard";
import SiteHeader from "@/components/SiteHeader";

export default function OpsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-12 pt-8">
        <OpsDashboard />
      </main>
    </>
  );
}
