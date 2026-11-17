// Plain-text helpers: HTML to text, tokenising, and picking the useful part of a job description.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", hellip: "..." };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/** Greenhouse double-encodes HTML (&lt;p&gt;), so decode, strip tags, then decode again. */
export function htmlToText(html: string): string {
  const tagged = decodeEntities(html);
  const stripped = tagged
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return collapse(decodeEntities(stripped));
}

export function collapse(s: string): string {
  return s.replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const STOP = new Set(["the", "and", "of", "for", "a", "an", "to", "in", "at", "with", "on", "&", "i", "ii", "iii", "iv"]);

/** Lowercase word tokens; keeps tech tokens like c++, c#, node.js. Works for non-English letters too. */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.]*/gu) ?? [])
    .map((t) => t.replace(/\.+$/, ""))
    .filter((t) => t && !STOP.has(t));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-term regex for a lowercased haystack ("go" must not match "google"). Compile once, reuse per job. */
export function termRegex(term: string): RegExp | null {
  const t = term.toLowerCase().trim();
  if (!t) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(t)}(?![\\p{L}\\p{N}])`, "u");
}

/** Case-insensitive whole-term match. */
export function containsTerm(haystackLower: string, term: string): boolean {
  return termRegex(term)?.test(haystackLower) ?? false;
}

const REQUIREMENTS = /(requirements|qualifications|what you('|’)ll (need|bring)|you (have|bring|might be a fit)|about you|we('|’)re looking for|who you are|you should have)/i;

/**
 * The part of a description that decides fit: start at the requirements section if there is one,
 * otherwise at the top. Keeps scoring input small without losing the signal.
 */
export function descriptionExcerpt(text: string, max: number): string {
  const at = text.search(REQUIREMENTS);
  const start = at > 150 ? at : 0;
  const slice = text.slice(start, start + max);
  return slice.length < text.length - start ? `${slice}...` : slice;
}

/** Board and resume text must not be able to close our <job>/<candidate> wrappers (prompt injection). */
export function neutralise(s: string): string {
  return s.replace(/<(\/?)(job|candidate|user_input)/gi, "&lt;$1$2");
}
