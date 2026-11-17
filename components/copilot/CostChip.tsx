export function CostChip({ usd, cached, label = "Cost" }: { usd: number; cached?: boolean; label?: string }) {
  return (
    <span className="rounded-md bg-zinc-50 px-2 py-0.5 text-sm text-zinc-500 ring-1 ring-zinc-200">
      {cached ? "Cached · $0 now" : `${label} $${usd.toFixed(4)}`}
    </span>
  );
}

export function Spinner({ light = false }: { light?: boolean }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 ${light ? "border-white/40 border-t-white" : "border-zinc-300 border-t-zinc-700"}`}
      aria-hidden
    />
  );
}

export function scrollToJob(id: string) {
  const el = document.getElementById(`job-${id}`);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  el.focus({ preventScroll: true });
}
