import { config } from "../../config.js";
import { HttpError, fetchJson } from "../../lib/http.js";
import {
  metrics, type AccountMetrics, type AccountRef, type MetricsResult, type OwnAnalyticsProvider,
  type OwnPost, type RawComment,
} from "../types.js";

/** Instagram API (with Facebook Login) — media, media insights and account insights. */

const graph = () => `https://graph.facebook.com/${config().META_GRAPH_VERSION}`;

// Insights metric sets differ by media product type; an unsupported metric fails the
// whole call, so each type has its own list plus a minimal fallback.
const METRICS_BY_TYPE: Record<string, string[]> = {
  REELS: ["views", "reach", "likes", "comments", "shares", "saved", "ig_reels_avg_watch_time", "total_interactions"],
  FEED: ["views", "reach", "likes", "comments", "shares", "saved", "profile_visits", "follows", "total_interactions"],
  STORY: ["views", "reach", "shares", "profile_visits", "follows"],
};
const FALLBACK_METRICS = ["reach", "likes", "comments", "shares", "saved"];

interface InsightsResponse {
  data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
}

export function parseInsights(res: InsightsResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of res.data) {
    const v = m.total_value?.value ?? m.values?.[0]?.value;
    if (typeof v === "number") out[m.name] = v;
  }
  return out;
}

export function normalizeInstagram(v: Record<string, number>): MetricsResult["metrics"] {
  return metrics({
    views: v.views,
    reach: v.reach,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    saves: v.saved,
    // Instagram reports reel watch time in milliseconds.
    avg_watch_seconds: v.ig_reels_avg_watch_time != null ? v.ig_reels_avg_watch_time / 1000 : null,
    profile_visits: v.profile_visits,
    followers_gained: v.follows,
  });
}

export class InstagramOwnProvider implements OwnAnalyticsProvider {
  readonly platform = "instagram" as const;

  async listRecentPosts(account: AccountRef, token: string, limit: number): Promise<OwnPost[]> {
    const url =
      `${graph()}/${account.external_account_id}/media?fields=id,caption,media_type,media_product_type,permalink,timestamp` +
      `&limit=${Math.min(limit, 50)}&access_token=${token}`;
    const res = await fetchJson<{ data: { id: string; caption?: string; media_product_type?: string; permalink?: string; timestamp: string }[] }>(
      url, { limitKey: `instagram:${account.id}` },
    );
    return res.data.map((m) => ({
      platform_post_id: m.id,
      published_at: m.timestamp,
      permalink: m.permalink ?? null,
      caption: m.caption ?? null,
      media_type: m.media_product_type ?? null,
      duration_seconds: null,
    }));
  }

  async fetchPostMetrics(account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult> {
    const wanted = METRICS_BY_TYPE[post.media_type ?? "FEED"] ?? METRICS_BY_TYPE.FEED!;
    const call = (list: string[]) =>
      fetchJson<InsightsResponse>(
        `${graph()}/${post.platform_post_id}/insights?metric=${list.join(",")}&access_token=${token}`,
        { limitKey: `instagram:${account.id}` },
      );
    let raw: InsightsResponse;
    try {
      raw = await call(wanted);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 400) throw err;
      raw = await call(FALLBACK_METRICS);
    }
    return { metrics: normalizeInstagram(parseInsights(raw)), raw };
  }

  async fetchAccountMetrics(account: AccountRef, token: string): Promise<AccountMetrics> {
    const key = `instagram:${account.id}`;
    const profile = await fetchJson<{ followers_count?: number }>(
      `${graph()}/${account.external_account_id}?fields=followers_count&access_token=${token}`, { limitKey: key },
    );
    const insights = await fetchJson<InsightsResponse>(
      `${graph()}/${account.external_account_id}/insights?metric=profile_views&period=day&metric_type=total_value&access_token=${token}`,
      { limitKey: key },
    ).catch(() => ({ data: [] }) as InsightsResponse);
    const v = parseInsights(insights);
    return { followers: profile.followers_count ?? null, profile_visits: v.profile_views ?? null, raw: { profile, insights } };
  }

  async fetchComments(account: AccountRef, token: string, platformPostId: string): Promise<RawComment[]> {
    const res = await fetchJson<{ data: { id: string; text: string; like_count?: number; timestamp?: string }[] }>(
      `${graph()}/${platformPostId}/comments?fields=id,text,like_count,timestamp&limit=100&access_token=${token}`,
      { limitKey: `instagram:${account.id}` },
    );
    return res.data.map((c) => ({
      platform_comment_id: c.id, text: c.text, like_count: c.like_count ?? null, published_at: c.timestamp ?? null,
    }));
  }
}
