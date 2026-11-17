// Location understanding: normalise free-text job/candidate locations to countries and regions,
// derive an honest workplace type, and score location fit for a candidate. Pure functions.
import type { Job, LocationFit, Workplace } from "./types";

const COUNTRY_TERMS: Record<string, string[]> = {
  India: ["india", "bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "gurgaon", "gurugram", "hyderabad", "pune", "chennai", "noida", "kolkata", "ahmedabad"],
  "United States": [
    "united states", "usa", "us", "u.s.", "usca", "san francisco", "sf", "new york", "nyc", "seattle", "chicago", "austin", "boston",
    "los angeles", "mountain view", "palo alto", "menlo park", "sunnyvale", "san jose", "denver", "atlanta", "miami", "pittsburgh",
    "portland", "san diego", "dallas", "houston", "philadelphia", "raleigh", "washington", "california", "texas", "colorado",
    "georgia", "ohio", "oregon", "pennsylvania", "illinois", "massachusetts", "missouri", "north carolina", "virginia", "florida",
    "arizona", "connecticut", "maryland", "new jersey", "indiana", "alabama", "south carolina", "michigan", "minnesota", "utah",
    "tennessee", "wisconsin",
  ],
  "United Kingdom": ["united kingdom", "uk", "london", "manchester", "edinburgh"],
  Ireland: ["ireland", "dublin"],
  Canada: ["canada", "toronto", "vancouver", "montreal", "waterloo"],
  Singapore: ["singapore"],
  Japan: ["japan", "tokyo"],
  Australia: ["australia", "sydney", "melbourne"],
  Germany: ["germany", "berlin", "munich"],
  France: ["france", "paris"],
  Netherlands: ["netherlands", "amsterdam"],
  "South Korea": ["south korea", "korea", "seoul"],
  Spain: ["spain", "madrid", "barcelona"],
  Brazil: ["brazil", "sao paulo", "são paulo"],
  Mexico: ["mexico", "mexico city"],
  Israel: ["israel", "tel aviv"],
  Switzerland: ["switzerland", "zurich"],
  Sweden: ["sweden", "stockholm"],
  Poland: ["poland", "warsaw"],
  China: ["china", "beijing", "shanghai"],
};

const REGION_OF: Record<string, string> = {
  India: "APAC", Singapore: "APAC", Japan: "APAC", Australia: "APAC", "South Korea": "APAC", China: "APAC",
  "United Kingdom": "EMEA", Ireland: "EMEA", Germany: "EMEA", France: "EMEA", Netherlands: "EMEA", Spain: "EMEA",
  Israel: "EMEA", Switzerland: "EMEA", Sweden: "EMEA", Poland: "EMEA",
  "United States": "AMER", Canada: "AMER", Mexico: "AMER", Brazil: "AMER",
};

const REGION_TERMS: Record<string, string[]> = {
  APAC: ["apac", "asia", "asia pacific", "asia-pacific"],
  EMEA: ["emea", "europe", "eu"],
  AMER: ["amer", "americas", "north america", "latam", "latin america"],
};
const GLOBAL = /(^|[^a-z])(global|worldwide|anywhere|international)([^a-z]|$)/;

function termRegex(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`);
}
// Compiled once at module load; regions first so "north america" isn't read as a country.
const COUNTRY_RES = Object.entries(COUNTRY_TERMS).map(([country, terms]) => ({ country, res: terms.map(termRegex) }));
const REGION_RES = Object.entries(REGION_TERMS).map(([region, terms]) => ({ region, res: terms.map(termRegex) }));

export type ParsedLocation = { countries: string[]; regions: string[]; global: boolean; remote: boolean; hybrid: boolean };

export function parseLocation(text: string): ParsedLocation {
  const t = text.toLowerCase();
  const regions = REGION_RES.filter((r) => r.res.some((re) => re.test(t))).map((r) => r.region);
  const countries = COUNTRY_RES.filter((c) => c.res.some((re) => re.test(t))).map((c) => c.country);
  return { countries, regions, global: GLOBAL.test(t), remote: /remote/.test(t), hybrid: /hybrid/.test(t) };
}

export function normaliseCountry(text: string | null | undefined): string | null {
  return text ? (parseLocation(text).countries[0] ?? null) : null;
}

const STRUCTURED: Record<string, Workplace> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

/**
 * Workplace and geography for a job. `structured` is the provider's own field (Ashby workplaceType);
 * without one we only say remote/hybrid when the posting says so, and otherwise "unknown" (never a guess).
 */
export function deriveLocation(text: string, structured: string | null | undefined, extraCountries: string[] = []) {
  const p = parseLocation(text);
  const fromField = structured ? STRUCTURED[structured.toLowerCase()] : undefined;
  const workplace: Workplace = fromField ?? (p.remote ? "remote" : p.hybrid ? "hybrid" : "unknown");
  const countries = [...new Set([...p.countries, ...extraCountries.map(normaliseCountry).filter((c): c is string => !!c)])];
  return { workplace, countries, regions: p.regions, remoteGlobal: workplace === "remote" && p.global };
}

export function workplaceLabel(w: Workplace): string {
  return w === "remote" ? "Remote" : w === "hybrid" ? "Hybrid" : w === "onsite" ? "On-site" : "Workplace not stated";
}

function shortPlace(job: Pick<Job, "location" | "countries">): string {
  const parts = job.location
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !/^(n\/?a|unspecified|tbd|-)$/i.test(s));
  if (parts.length === 0) return job.countries.join(", ") || "Location not stated";
  return parts.length > 1 ? `${parts[0]} +${parts.length - 1}` : parts[0];
}

/** "Hybrid · Bengaluru"; when the board doesn't state the workplace we show only the place (no guess). */
function placeLabel(job: Pick<Job, "location" | "countries" | "workplace">, suffix = ""): string {
  const place = shortPlace(job) + suffix;
  return job.workplace === "unknown" ? place : `${workplaceLabel(job.workplace)} · ${place}`;
}

export function isIndiaFriendly(job: Pick<Job, "countries" | "regions" | "workplace" | "remoteGlobal">): boolean {
  return job.countries.includes("India") || (job.workplace === "remote" && (job.remoteGlobal || job.regions.includes("APAC")));
}

/** How well a job's location works for a candidate living in `country`. 1 = same country. */
export function locationFit(country: string | null, job: Pick<Job, "location" | "countries" | "regions" | "workplace" | "remoteGlobal">): LocationFit {
  const indiaFriendly = isIndiaFriendly(job);
  if (job.workplace === "remote") {
    const region = country ? REGION_OF[country] : undefined;
    if (job.remoteGlobal) return { score: 0.9, label: "Remote · anywhere", indiaFriendly };
    if (country && (job.countries.includes(country) || (region && job.regions.includes(region))))
      return { score: 0.95, label: `Remote · open to ${country}`, indiaFriendly };
    if (!job.countries.length && !job.regions.length) return { score: 0.6, label: "Remote · region not stated", indiaFriendly };
    const scope = [...job.regions, ...job.countries].slice(0, 2).join(", ");
    return { score: country ? 0.3 : 0.8, label: `Remote · ${scope} only`, indiaFriendly };
  }
  if (!country) return { score: 0.8, label: placeLabel(job), indiaFriendly };
  if (job.countries.includes(country)) return { score: job.workplace === "hybrid" ? 0.95 : 1, label: placeLabel(job), indiaFriendly };
  if (!job.countries.length) return { score: 0.5, label: placeLabel(job), indiaFriendly };
  return { score: 0.2, label: placeLabel(job, " (relocation)"), indiaFriendly };
}
