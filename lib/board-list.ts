// The 10 boards we read. Shared by the server fetcher and the live funnel UI (no server imports here).
export type Source = "greenhouse" | "ashby";
export type Board = { company: string; slug: string; source: Source };

export const BOARDS: Board[] = [
  { company: "Stripe", slug: "stripe", source: "greenhouse" },
  { company: "Databricks", slug: "databricks", source: "greenhouse" },
  { company: "Airbnb", slug: "airbnb", source: "greenhouse" },
  { company: "Duolingo", slug: "duolingo", source: "greenhouse" },
  { company: "Discord", slug: "discord", source: "greenhouse" },
  { company: "OpenAI", slug: "openai", source: "ashby" },
  { company: "Ramp", slug: "ramp", source: "ashby" },
  { company: "Notion", slug: "notion", source: "ashby" },
  { company: "Supabase", slug: "supabase", source: "ashby" },
  { company: "Linear", slug: "linear", source: "ashby" },
];
