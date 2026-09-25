import { median } from "../lib/stats.js";

export const WINNER_RATIO = 2.5;

interface PostCounts {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

/**
 * Outlier ratio: a post's views (or likes + 2 x comments when views are not
 * available) divided by its account's median over its last 30 posts. One metric
 * is used for the whole account so ratios are comparable. Winners are >= 2.5x.
 */
export function outlierRatios<T extends PostCounts & { published_at: string | null }>(posts: T[]): (T & { outlier_ratio: number | null })[] {
  const recent = [...posts].sort((a, b) => Date.parse(b.published_at ?? "0") - Date.parse(a.published_at ?? "0")).slice(0, 30);
  const withViews = recent.filter((p) => p.views != null).length;
  const useViews = withViews >= recent.length / 2 && withViews > 0;
  const value = (p: PostCounts): number | null =>
    useViews ? p.views : p.likes == null && p.comments == null ? null : (p.likes ?? 0) + 2 * (p.comments ?? 0);
  const base = median(recent.map(value).filter((v): v is number => v != null));
  return posts.map((p) => {
    const v = value(p);
    return { ...p, outlier_ratio: v == null || !base ? null : v / base };
  });
}
