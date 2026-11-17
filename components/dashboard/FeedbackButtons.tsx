"use client";

type Props = { vote: 1 | -1 | undefined; onVote: (v: 1 | -1 | 0) => void };

const base =
  "rounded-lg px-2.5 py-1.5 text-sm ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600";

/** Thumbs up/down; clicking the active one clears it. Nudges this user's future rankings. */
export default function FeedbackButtons({ vote, onVote }: Props) {
  return (
    <span className="ml-auto flex items-center gap-1" role="group" aria-label="Rate this match">
      <button
        type="button"
        aria-pressed={vote === 1}
        aria-label="Good fit: show more like this"
        title="Good fit: show more like this"
        onClick={() => onVote(vote === 1 ? 0 : 1)}
        className={`${base} ${vote === 1 ? "bg-emerald-50 text-emerald-700 ring-emerald-600/30" : "text-zinc-500 ring-zinc-200 hover:bg-zinc-50"}`}
      >
        👍
      </button>
      <button
        type="button"
        aria-pressed={vote === -1}
        aria-label="Not for me: show fewer like this"
        title="Not for me: show fewer like this"
        onClick={() => onVote(vote === -1 ? 0 : -1)}
        className={`${base} ${vote === -1 ? "bg-rose-50 text-rose-700 ring-rose-600/30" : "text-zinc-500 ring-zinc-200 hover:bg-zinc-50"}`}
      >
        👎
      </button>
    </span>
  );
}
