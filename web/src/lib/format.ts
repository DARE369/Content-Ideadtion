import type { Confidence, Goal, Platform, Relative } from "./types";

export const PLATFORM_META: Record<Platform, { name: string; short: string; className: string }> = {
  instagram: { name: "Instagram", short: "IG", className: "bg-[#fde7f0] text-[#9b1b5a] dark:bg-[#3a1a29] dark:text-[#f5a3c7]" },
  tiktok: { name: "TikTok", short: "TT", className: "bg-[#e4f5f4] text-[#0f5f5b] dark:bg-[#15302e] dark:text-[#7fdad3]" },
  youtube: { name: "YouTube", short: "YT", className: "bg-[#fde6e4] text-[#a3160c] dark:bg-[#3a1a18] dark:text-[#f59b93]" },
  facebook: { name: "Facebook", short: "FB", className: "bg-[#e5eefc] text-[#1b4fa3] dark:bg-[#18253a] dark:text-[#9dbdf5]" },
  linkedin: { name: "LinkedIn", short: "in", className: "bg-[#e3eff8] text-[#0a4d7f] dark:bg-[#162838] dark:text-[#8fc3ea]" },
};
export const ALL_PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "facebook", "linkedin"];

export const GOAL_META: Record<Goal, { name: string; blurb: string; metric: string }> = {
  reach: { name: "Reach", blurb: "More people discover you and follow.", metric: "follows" },
  engagement: { name: "Engagement", blurb: "More comments, saves and shares.", metric: "interactions" },
  leads: { name: "Leads", blurb: "More link clicks and enquiries.", metric: "link clicks" },
  sales: { name: "Sales", blurb: "More orders from your posts.", metric: "link clicks" },
};

export const RELATIVE_TEXT: Record<Relative, string> = {
  top_third: "Likely top third of your posts",
  middle_third: "Likely a typical post for you",
  bottom_third: "Likely below your usual",
};
export const CONFIDENCE_TEXT: Record<Confidence, string> = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const num = (n: number | null | undefined) => (n == null ? "—" : nf.format(Math.round(n)));
export const compact = (n: number | null | undefined) => (n == null ? "—" : cf.format(n));
export const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const multiple = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}×`);

/** "Price reveal" from price_reveal; also formats "16-30s" and "09-12" nicely. */
export function humanize(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{2}-\d{2}$/.test(v)) return `${v.slice(0, 2)}:00–${v.slice(3)}:00`;
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const FEATURE_NAMES: Record<string, string> = {
  hook_type: "Opener", format: "Format", pillar: "Content pillar", length_bucket: "Length", posting_day: "Day",
  posting_hour: "Time", idea_source: "Idea source", cta_type: "Call to action", visual_style: "Visual style", language: "Language",
  funnel_stage: "Buyer stage", offer: "Sells",
};

export const STAGE_TEXT: Record<string, { label: string; help: string }> = {
  awareness: { label: "Awareness", help: "For buyers who don't see the problem yet" },
  consideration: { label: "Consideration", help: "For buyers weighing their options" },
  decision: { label: "Decision", help: "For buyers close to buying; removes a hesitation" },
};

/** Progress narration while ideas are generated (market scan, then 15 drafts cut to a shortlist of 8). */
export const IDEA_STEPS = [
  "Scanning your market for news and buyer questions",
  "Reading your brand and what you sell",
  "Drafting 15 ideas",
  "An editor cuts the weak ones",
  "Keeping the best 8 for this week",
];

const DAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export function featureValue(feature: string, value: string): string {
  if (feature === "posting_day") return DAY_NAMES[value] ?? value;
  if (feature === "offer") return value === "brand" ? "Brand trust" : value;
  if (feature === "funnel_stage") return STAGE_TEXT[value]?.label ?? humanize(value);
  return humanize(value);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return shortDate(iso);
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
export const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function weekRange(d = new Date()): string {
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d.getTime() - day * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return `${shortDate(start.toISOString())} – ${shortDate(end.toISOString())}`;
}

/** Plain-language change between two values, e.g. "up 18% from a month ago". */
export function change(now: number | null | undefined, before: number | null | undefined, kind: "ratio" | "points" = "ratio") {
  if (now == null || before == null || before === 0) return null;
  const d = kind === "points" ? (now - before) * 100 : ((now - before) / before) * 100;
  const dir = Math.abs(d) < 1 ? "flat" : d > 0 ? "up" : "down";
  const amount = kind === "points" ? `${Math.abs(d).toFixed(0)} pts` : `${Math.abs(d).toFixed(0)}%`;
  return { dir, text: dir === "flat" ? "about the same as a month ago" : `${dir} ${amount} from a month ago` } as const;
}

export const LANGUAGES = [
  ["en-NG", "English (Nigeria)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["en-GH", "English (Ghana)"],
  ["en-KE", "English (Kenya)"], ["en-ZA", "English (South Africa)"], ["en-IN", "English (India)"], ["fr-FR", "French (France)"],
  ["fr-CI", "French (Côte d'Ivoire)"], ["pt-BR", "Portuguese (Brazil)"], ["es-ES", "Spanish (Spain)"], ["es-MX", "Spanish (Mexico)"],
  ["de-DE", "German"], ["ar-EG", "Arabic (Egypt)"], ["sw-KE", "Swahili (Kenya)"], ["yo-NG", "Yoruba"], ["ha-NG", "Hausa"],
] as const;
