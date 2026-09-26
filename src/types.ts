export const PLATFORMS = ["tiktok", "instagram", "facebook", "youtube", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const GOALS = ["reach", "engagement", "leads", "sales"] as const;
export type Goal = (typeof GOALS)[number];

export const SNAPSHOT_OFFSETS = ["1h", "6h", "24h", "72h", "7d", "28d"] as const;
export type SnapshotOffset = (typeof SNAPSHOT_OFFSETS)[number];

/** Features the learning loop tracks on every idea and post. */
export const FEATURE_KEYS = [
  "hook_type",
  "format",
  "pillar",
  "length_bucket",
  "posting_day",
  "posting_hour",
  "idea_source",
  "cta_type",
  "visual_style",
  "language",
  "funnel_stage",
  "offer",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Partial<Record<FeatureKey, string>>;

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}
