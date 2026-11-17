"use client";

import { DEFAULT_FILTERS, isFiltered, type Filters } from "@/lib/filters";

type Props = { filters: Filters; onChange: (f: Filters) => void; companies: string[]; shown: number; total: number };

const pill = (on: boolean) =>
  `rounded-full px-3 py-1 text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 ${
    on ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50"
  }`;

const select =
  "rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600";

export default function FiltersBar({ filters, onChange, companies, shown, total }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleCompany = (c: string) =>
    set({ companies: filters.companies.includes(c) ? filters.companies.filter((x) => x !== c) : [...filters.companies, c] });

  return (
    <section aria-label="Filter and sort matches" className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Companies">
        {companies.map((c) => (
          <button key={c} type="button" aria-pressed={filters.companies.includes(c)} onClick={() => toggleCompany(c)} className={pill(filters.companies.includes(c))}>
            {c}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-zinc-500">Tier</span>
          <select className={select} value={filters.tier} onChange={(e) => set({ tier: e.target.value as Filters["tier"] })}>
            <option value="all">All</option>
            <option value="strong">Strong</option>
            <option value="good">Good</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-zinc-500">Workplace</span>
          <select className={select} value={filters.workplace} onChange={(e) => set({ workplace: e.target.value as Filters["workplace"] })}>
            <option value="any">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="office">On-site or not stated</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={filters.indiaFriendly}
            onChange={(e) => set({ indiaFriendly: e.target.checked })}
            className="h-4 w-4 rounded accent-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-600"
          />
          India-friendly
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-zinc-500">Sort</span>
          <select className={select} value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })}>
            <option value="score">Best match</option>
            <option value="newest">Newest</option>
          </select>
        </label>
        <span className="ml-auto text-zinc-500" aria-live="polite">
          {shown} of {total}
          {isFiltered(filters) && (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
              className="ml-2 rounded font-semibold text-indigo-600 transition-colors hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              Clear
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
