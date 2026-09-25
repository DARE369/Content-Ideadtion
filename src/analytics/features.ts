import type { Features } from "../types.js";

/** Length buckets shared by ideas, briefs and posts so the learning loop compares like with like. */
export function lengthBucket(seconds: number | null | undefined): string | undefined {
  if (seconds == null) return undefined;
  if (seconds <= 15) return "0-15s";
  if (seconds <= 30) return "16-30s";
  if (seconds <= 60) return "31-60s";
  if (seconds <= 180) return "61-180s";
  return "180s+";
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Posting day and a 3-hour bucket, in the brand's time zone. */
export function postingTimeFeatures(publishedAt: Date, timeZone = "UTC"): Pick<Features, "posting_day" | "posting_hour"> {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(publishedAt);
  const day = parts.find((p) => p.type === "weekday")!.value.slice(0, 3).toLowerCase();
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const start = Math.floor(hour / 3) * 3;
  return { posting_day: DAYS.includes(day) ? day : undefined, posting_hour: `${String(start).padStart(2, "0")}-${String(start + 3).padStart(2, "0")}` };
}

/** Freeze the features a post is learned on at publish time. */
export function publishFeatures(
  ideaFeatures: Features | null | undefined,
  brief: { format?: string; cta_type?: string; language?: string } | null,
  publishedAt: Date,
  durationSeconds: number | null | undefined,
  timeZone?: string,
): Features {
  const f: Features = { ...(ideaFeatures ?? {}) };
  if (brief?.format) f.format = brief.format;
  if (brief?.cta_type) f.cta_type = brief.cta_type;
  if (brief?.language) f.language = brief.language;
  const lb = lengthBucket(durationSeconds);
  if (lb) f.length_bucket = lb;
  Object.assign(f, postingTimeFeatures(publishedAt, timeZone));
  for (const k of Object.keys(f) as (keyof Features)[]) if (f[k] === undefined) delete f[k];
  return f;
}
