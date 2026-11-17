import type { Breakdown } from "@/lib/types";

const LABELS: { key: keyof Breakdown; label: string; hint: string }[] = [
  { key: "skills", label: "Skills", hint: "Your skills vs the role's stated must-haves (Haiku)" },
  { key: "seniority", label: "Seniority", hint: "Your level and years vs the role's level (Haiku)" },
  { key: "location", label: "Location", hint: "Computed in code from the posting's location and workplace type" },
  { key: "domain", label: "Domain", hint: "How close your industry experience is (Haiku)" },
];

/** Four small bars that show why a score is what it is. */
export default function ScoreBars({ breakdown, compact = false }: { breakdown: Breakdown; compact?: boolean }) {
  return (
    <dl className={`grid gap-x-6 gap-y-1.5 text-sm ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
      {LABELS.map(({ key, label, hint }) => {
        const v = Math.max(0, Math.min(100, breakdown[key]));
        return (
          <div key={key} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2" title={hint}>
            <dt className="text-zinc-500">{label}</dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
              <span className="block h-full rounded-full bg-indigo-600/80 transition-[width] duration-500" style={{ width: `${v}%` }} />
            </dd>
            <dd className="text-right tabular-nums text-zinc-500">
              {v}
              <span className="sr-only"> out of 100</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
