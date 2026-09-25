import { mean, median } from "../lib/stats.js";
import { FEATURE_KEYS } from "../types.js";

/**
 * The numbers behind every report, computed in code. Claude only interprets
 * these tables and must cite post ids for every claim.
 */

export interface ReportPost {
  post_id: string;
  platform: string;
  published_at: string;
  views: number | null;
  pi: number | null;
  goal_index: number | null;
  comments: number | null;
  label: "proven" | "test" | null;
  features: Record<string, string>;
}

export interface RollingPoint {
  platform: string;
  week: string;
  median_views: number;
  p25_views: number;
  hit_rate: number | null;
}

export interface FeatureRow {
  platform: string;
  feature: string;
  value: string;
  n: number;
  mean_pi: number;
  post_ids: string[];
}

export interface WeeklyTables {
  period: { start: string; end: string };
  platforms: {
    platform: string;
    posts_this_period: number;
    median_pi: number | null;
    hit_rate: number | null;
    rolling_median_now: number | null;
    rolling_median_4w_ago: number | null;
    p25_now: number | null;
    p25_4w_ago: number | null;
    best: { post_id: string; pi: number } | null;
    worst: { post_id: string; pi: number } | null;
    proven_mean_pi: number | null;
    test_mean_pi: number | null;
    comments_this_period: number;
    explore_share: number;
    explore_reason: string | null;
  }[];
  features: FeatureRow[];
  posts: { post_id: string; platform: string; published_at: string; pi: number | null; goal_index: number | null; views: number | null; label: string | null; features: string }[];
}

const round = (n: number | null, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Feature comparison over the lookback window (28 days gives more signal than one week). */
export function featureTable(posts: ReportPost[], minN = 2): FeatureRow[] {
  const groups = new Map<string, ReportPost[]>();
  for (const p of posts) {
    if (p.pi == null) continue;
    for (const f of FEATURE_KEYS) {
      const v = p.features[f];
      if (!v || f === "language") continue;
      const k = `${p.platform}|${f}|${v}`;
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
  }
  const rows: FeatureRow[] = [];
  for (const [k, ps] of groups) {
    if (ps.length < minN) continue;
    const [platform, feature, value] = k.split("|") as [string, string, string];
    rows.push({ platform, feature, value, n: ps.length, mean_pi: round(mean(ps.map((p) => p.pi!)))!, post_ids: ps.map((p) => p.post_id) });
  }
  return rows.sort((a, b) => b.mean_pi - a.mean_pi);
}

export function weeklyTables(
  period: { start: Date; end: Date },
  lookback: ReportPost[],
  rolling: RollingPoint[],
  explore: Record<string, { share: number; reason: string | null }>,
): WeeklyTables {
  const inPeriod = lookback.filter((p) => {
    const t = Date.parse(p.published_at);
    return t >= period.start.getTime() && t < period.end.getTime();
  });
  const platforms = [...new Set(lookback.map((p) => p.platform))].sort();
  return {
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    platforms: platforms.map((platform) => {
      const ps = inPeriod.filter((p) => p.platform === platform);
      const withPi = ps.filter((p) => p.pi != null);
      const roll = rolling.filter((r) => r.platform === platform).sort((a, b) => a.week.localeCompare(b.week));
      const now = roll.at(-1);
      const before = roll.length >= 5 ? roll.at(-5) : roll[0] !== now ? roll[0] : undefined;
      const sorted = [...withPi].sort((a, b) => b.pi! - a.pi!);
      const byLabel = (l: string) => round(mean(withPi.filter((p) => p.label === l).map((p) => p.pi!)));
      return {
        platform,
        posts_this_period: ps.length,
        median_pi: round(median(withPi.map((p) => p.pi!))),
        hit_rate: withPi.length ? round(withPi.filter((p) => p.pi! > 1).length / withPi.length) : null,
        rolling_median_now: round(now?.median_views ?? null, 0),
        rolling_median_4w_ago: round(before?.median_views ?? null, 0),
        p25_now: round(now?.p25_views ?? null, 0),
        p25_4w_ago: round(before?.p25_views ?? null, 0),
        best: sorted[0] ? { post_id: sorted[0].post_id, pi: round(sorted[0].pi)! } : null,
        worst: sorted.length > 1 ? { post_id: sorted.at(-1)!.post_id, pi: round(sorted.at(-1)!.pi)! } : null,
        proven_mean_pi: byLabel("proven"),
        test_mean_pi: byLabel("test"),
        comments_this_period: ps.reduce((s, p) => s + (p.comments ?? 0), 0),
        explore_share: explore[platform]?.share ?? 0.2,
        explore_reason: explore[platform]?.reason ?? null,
      };
    }),
    features: featureTable(lookback),
    posts: lookback.map((p) => ({
      post_id: p.post_id, platform: p.platform, published_at: p.published_at, pi: round(p.pi), goal_index: round(p.goal_index),
      views: p.views, label: p.label,
      features: Object.entries(p.features).filter(([k]) => k !== "language").map(([k, v]) => `${k}=${v}`).join(","),
    })),
  };
}

/** Keep only claims that cite at least one real post id from the tables. */
export function keepCited<T extends { post_ids: string[] }>(items: T[], known: Set<string>): T[] {
  return items
    .map((i) => ({ ...i, post_ids: i.post_ids.filter((id) => known.has(id)) }))
    .filter((i) => i.post_ids.length > 0);
}
