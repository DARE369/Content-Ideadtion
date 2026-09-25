import { fetchJson } from "../../lib/http.js";
import {
  metrics, type AccountMetrics, type AccountRef, type MetricsResult, type OwnAnalyticsProvider,
  type OwnPost, type RawComment,
} from "../types.js";

/**
 * YouTube Data API (real-time counts) + YouTube Analytics API (watch time,
 * retention, subscribers gained). Analytics data lags 1-2 days, so early
 * snapshots rely on Data API counts and later ones fill in the rest.
 * Every Data API list call costs 1 quota unit from the 10,000/day project quota.
 */

const DATA = "https://www.googleapis.com/youtube/v3";
const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports";

/** ISO 8601 duration (PT1M5S) to seconds. */
export function parseIsoDuration(d: string | undefined): number | null {
  if (!d) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
  if (!m) return null;
  const [, dd, h, mm, s] = m.map((x) => Number(x ?? 0));
  return dd! * 86400 + h! * 3600 + mm! * 60 + s!;
}

interface AnalyticsReport {
  columnHeaders: { name: string }[];
  rows?: (string | number)[][];
}

export function analyticsRow(r: AnalyticsReport): Record<string, number> {
  const row = r.rows?.[0];
  if (!row) return {};
  const out: Record<string, number> = {};
  r.columnHeaders.forEach((h, i) => {
    if (typeof row[i] === "number") out[h.name] = row[i] as number;
  });
  return out;
}

export function normalizeYouTube(
  stats: { viewCount?: string; likeCount?: string; commentCount?: string },
  a: Record<string, number>,
  durationSeconds: number | null,
): MetricsResult["metrics"] {
  const avg = a.averageViewDuration ?? null;
  return metrics({
    views: stats.viewCount != null ? Number(stats.viewCount) : a.views,
    likes: stats.likeCount != null ? Number(stats.likeCount) : a.likes,
    comments: stats.commentCount != null ? Number(stats.commentCount) : a.comments,
    shares: a.shares,
    avg_watch_seconds: avg,
    // averageViewPercentage is 0-100; above 100 means re-watches, capped for a rate.
    completion_rate:
      a.averageViewPercentage != null ? Math.min(1, a.averageViewPercentage / 100)
      : avg != null && durationSeconds ? Math.min(1, avg / durationSeconds) : null,
    followers_gained: a.subscribersGained,
  });
}

export class YouTubeOwnProvider implements OwnAnalyticsProvider {
  readonly platform = "youtube" as const;

  private data<T>(path: string, token: string) {
    return fetchJson<T>(`${DATA}${path}`, { headers: { authorization: `Bearer ${token}` }, limitKey: "youtube_quota", cost: 1 });
  }

  async listRecentPosts(_account: AccountRef, token: string, limit: number): Promise<OwnPost[]> {
    const ch = await this.data<{ items: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(
      "/channels?part=contentDetails&mine=true", token,
    );
    const uploads = ch.items[0]?.contentDetails.relatedPlaylists.uploads;
    if (!uploads) return [];
    const pl = await this.data<{ items: { contentDetails: { videoId: string } }[] }>(
      `/playlistItems?part=contentDetails&maxResults=${Math.min(limit, 50)}&playlistId=${uploads}`, token,
    );
    const ids = pl.items.map((i) => i.contentDetails.videoId);
    if (ids.length === 0) return [];
    const vids = await this.data<{
      items: { id: string; snippet: { publishedAt: string; title: string; description: string }; contentDetails: { duration: string } }[];
    }>(`/videos?part=snippet,contentDetails&id=${ids.join(",")}`, token);
    return vids.items.map((v) => ({
      platform_post_id: v.id,
      published_at: v.snippet.publishedAt,
      permalink: `https://www.youtube.com/watch?v=${v.id}`,
      caption: `${v.snippet.title}\n\n${v.snippet.description}`,
      media_type: "video",
      duration_seconds: parseIsoDuration(v.contentDetails.duration),
    }));
  }

  async fetchPostMetrics(_account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult> {
    const v = await this.data<{ items: { statistics: Record<string, string>; contentDetails: { duration: string } }[] }>(
      `/videos?part=statistics,contentDetails&id=${post.platform_post_id}`, token,
    );
    const item = v.items[0];
    if (!item) throw new Error(`YouTube video ${post.platform_post_id} not found`);
    const start = post.published_at.slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const report = await fetchJson<AnalyticsReport>(
      `${ANALYTICS}?ids=channel==MINE&startDate=${start}&endDate=${end}` +
        `&metrics=views,likes,comments,shares,averageViewDuration,averageViewPercentage,subscribersGained` +
        `&filters=video==${post.platform_post_id}`,
      { headers: { authorization: `Bearer ${token}` }, limitKey: "youtube_analytics" },
    ).catch(() => ({ columnHeaders: [] }) as AnalyticsReport);
    const duration = parseIsoDuration(item.contentDetails.duration) ?? post.duration_seconds;
    return { metrics: normalizeYouTube(item.statistics, analyticsRow(report), duration), raw: { statistics: item.statistics, report } };
  }

  async fetchAccountMetrics(_account: AccountRef, token: string): Promise<AccountMetrics> {
    const ch = await this.data<{ items: { statistics: { subscriberCount?: string } }[] }>(
      "/channels?part=statistics&mine=true", token,
    );
    const subs = ch.items[0]?.statistics.subscriberCount;
    return { followers: subs != null ? Number(subs) : null, profile_visits: null, raw: ch };
  }

  async fetchComments(_account: AccountRef, token: string, platformPostId: string): Promise<RawComment[]> {
    return youtubeComments(platformPostId, { authorization: `Bearer ${token}` });
  }
}

/** Shared with the competitor provider (public comments work with an API key). */
export async function youtubeComments(videoId: string, auth: { authorization?: string; key?: string }): Promise<RawComment[]> {
  const keyParam = auth.key ? `&key=${auth.key}` : "";
  const res = await fetchJson<{
    items: { id: string; snippet: { topLevelComment: { snippet: { textOriginal: string; likeCount: number; publishedAt: string } } } }[];
  }>(`${DATA}/commentThreads?part=snippet&order=relevance&maxResults=100&videoId=${videoId}${keyParam}`, {
    headers: auth.authorization ? { authorization: auth.authorization } : {},
    limitKey: "youtube_quota",
    cost: 1,
  });
  return res.items.map((c) => ({
    platform_comment_id: c.id,
    text: c.snippet.topLevelComment.snippet.textOriginal,
    like_count: c.snippet.topLevelComment.snippet.likeCount,
    published_at: c.snippet.topLevelComment.snippet.publishedAt,
  }));
}
