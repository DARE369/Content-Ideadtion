import { config } from "../../config.js";
import { HttpError, fetchJson } from "../../lib/http.js";
import {
  metrics, type AccountMetrics, type AccountRef, type MetricsResult, type OwnAnalyticsProvider,
  type OwnPost, type RawComment,
} from "../types.js";
import { parseInsights } from "./instagram.js";

/** Facebook Pages API — post and page insights. The page token comes from the studio. */

const graph = () => `https://graph.facebook.com/${config().META_GRAPH_VERSION}`;

const POST_METRICS = ["post_media_view", "post_impressions_unique", "post_clicks", "post_video_views", "post_video_avg_time_watched"];
const POST_METRICS_FALLBACK = ["post_impressions_unique", "post_clicks"];

export function normalizeFacebook(
  insights: Record<string, number>,
  fields: { reactions?: number; comments?: number; shares?: number },
): MetricsResult["metrics"] {
  return metrics({
    views: insights.post_media_view ?? insights.post_video_views,
    reach: insights.post_impressions_unique,
    likes: fields.reactions,
    comments: fields.comments,
    shares: fields.shares,
    link_clicks: insights.post_clicks,
    // Facebook reports average watch time in milliseconds.
    avg_watch_seconds: insights.post_video_avg_time_watched != null ? insights.post_video_avg_time_watched / 1000 : null,
  });
}

export class FacebookOwnProvider implements OwnAnalyticsProvider {
  readonly platform = "facebook" as const;

  async listRecentPosts(account: AccountRef, token: string, limit: number): Promise<OwnPost[]> {
    const res = await fetchJson<{ data: { id: string; message?: string; created_time: string; permalink_url?: string }[] }>(
      `${graph()}/${account.external_account_id}/posts?fields=id,message,created_time,permalink_url&limit=${Math.min(limit, 50)}&access_token=${token}`,
      { limitKey: `facebook:${account.id}` },
    );
    return res.data.map((p) => ({
      platform_post_id: p.id, published_at: p.created_time, permalink: p.permalink_url ?? null,
      caption: p.message ?? null, media_type: null, duration_seconds: null,
    }));
  }

  async fetchPostMetrics(account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult> {
    const key = `facebook:${account.id}`;
    const call = (list: string[]) =>
      fetchJson<{ data: { name: string; values?: { value: number }[] }[] }>(
        `${graph()}/${post.platform_post_id}/insights?metric=${list.join(",")}&access_token=${token}`, { limitKey: key },
      );
    let insights;
    try {
      insights = await call(POST_METRICS);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 400) throw err;
      insights = await call(POST_METRICS_FALLBACK);
    }
    const fields = await fetchJson<{
      shares?: { count: number }; reactions?: { summary: { total_count: number } }; comments?: { summary: { total_count: number } };
    }>(
      `${graph()}/${post.platform_post_id}?fields=shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)&access_token=${token}`,
      { limitKey: key },
    );
    return {
      metrics: normalizeFacebook(parseInsights(insights), {
        reactions: fields.reactions?.summary.total_count,
        comments: fields.comments?.summary.total_count,
        shares: fields.shares?.count,
      }),
      raw: { insights, fields },
    };
  }

  async fetchAccountMetrics(account: AccountRef, token: string): Promise<AccountMetrics> {
    const res = await fetchJson<{ followers_count?: number; fan_count?: number }>(
      `${graph()}/${account.external_account_id}?fields=followers_count,fan_count&access_token=${token}`,
      { limitKey: `facebook:${account.id}` },
    );
    return { followers: res.followers_count ?? res.fan_count ?? null, profile_visits: null, raw: res };
  }

  async fetchComments(account: AccountRef, token: string, platformPostId: string): Promise<RawComment[]> {
    const res = await fetchJson<{ data: { id: string; message: string; like_count?: number; created_time?: string }[] }>(
      `${graph()}/${platformPostId}/comments?fields=id,message,like_count,created_time&limit=100&access_token=${token}`,
      { limitKey: `facebook:${account.id}` },
    );
    return res.data.map((c) => ({
      platform_comment_id: c.id, text: c.message, like_count: c.like_count ?? null, published_at: c.created_time ?? null,
    }));
  }
}
