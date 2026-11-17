// Board payload -> normalised Job. External payloads are validated; a malformed job is skipped.
import { createHash } from "node:crypto";
import { z } from "zod";
import { deriveLocation } from "./location";
import { collapse, htmlToText } from "./text";
import type { Job } from "./types";

const MAX_DESCRIPTION = 6_000;

// Ids are interpolated into prompts and urls into hrefs, so both are constrained.
const SafeId = z.string().regex(/^[\w-]+$/);
const HttpsUrl = z.string().regex(/^https:\/\/[^\s"<>]+$/);
const Address = z.object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() }).nullish();

const GreenhouseJob = z.object({
  id: z.union([z.number(), SafeId]),
  title: z.string(),
  absolute_url: HttpsUrl,
  location: z.object({ name: z.string().nullish() }).nullish(),
  offices: z.array(z.object({ name: z.string().nullish() })).nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  content: z.string().nullish(),
  departments: z.array(z.object({ name: z.string() })).nullish(),
});

const AshbyJob = z.object({
  id: SafeId,
  title: z.string(),
  jobUrl: HttpsUrl,
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish(), address: Address })).nullish(),
  address: Address,
  workplaceType: z.string().nullish(), // "Remote" | "Hybrid" | "OnSite" | null: the honest, structured field
  department: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  isListed: z.boolean().nullish(),
});

function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

export function fromGreenhouse(company: string, raw: unknown): Job | null {
  const p = GreenhouseJob.safeParse(raw);
  if (!p.success) return null;
  const j = p.data;
  const location = j.location?.name?.trim() || "Unspecified";
  // Greenhouse has no workplace field: offices and the location text are all we have.
  const offices = (j.offices ?? []).map((o) => o.name ?? "").filter(Boolean);
  const geo = deriveLocation([location, ...offices].join("; "), null);
  const description = htmlToText(j.content ?? "").slice(0, MAX_DESCRIPTION);
  return {
    id: `gh:${company.toLowerCase()}:${j.id}`,
    company,
    title: j.title.trim(),
    location,
    ...geo,
    department: j.departments?.[0]?.name?.replace(/^\d+\s+/, "") ?? "",
    url: j.absolute_url,
    postedAt: j.first_published ?? j.updated_at ?? undefined,
    description,
    contentHash: hash(j.title, location, description),
  };
}

export function fromAshby(company: string, raw: unknown): Job | null {
  const p = AshbyJob.safeParse(raw);
  if (!p.success || p.data.isListed === false) return null;
  const j = p.data;
  const extra = (j.secondaryLocations ?? []).map((l) => l.location).filter((l): l is string => !!l);
  const location = [j.location, ...extra].filter(Boolean).join("; ") || "Unspecified";
  const addressCountries = [j.address, ...(j.secondaryLocations ?? []).map((l) => l.address)]
    .map((a) => a?.postalAddress?.addressCountry)
    .filter((c): c is string => !!c);
  const geo = deriveLocation(location, j.workplaceType, addressCountries);
  const description = collapse(j.descriptionPlain ?? "").slice(0, MAX_DESCRIPTION);
  return {
    id: `ab:${company.toLowerCase()}:${j.id}`,
    company,
    title: j.title.trim(),
    location,
    ...geo,
    department: j.department ?? "",
    url: j.jobUrl,
    postedAt: j.publishedAt ?? undefined,
    description,
    contentHash: hash(j.title, location, description),
  };
}
