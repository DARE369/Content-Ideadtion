import { fetchJson } from "../../lib/http.js";
import {
  metrics, type AccountMetrics, type AccountRef, type MetricsResult, type OwnAnalyticsProvider,
  type OwnPost, type RawComment,
} from "../types.js";

/** TikTok Display API v2 (Login Kit scopes: user.info.basic, video.list). */

const API = "https://open.tiktokapis.com/v2";
const VIDEO_FIELDS = "id,create_time,share_url,video_description,duration,view_count,like_count,comment_count,share_count,cover_image_url";

export interface TikTokVideo {
  id: string;
  create_time: number;
  share_url?: string;
  video_description?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

interface TikTokEnvelope<T> {
  data: T;
  error: { code: string; message: string };
}

function unwrap<T>(res: TikTokEnvelope<T>): T {
  if (res.error && res.error.code !== "ok") throw new Error(`TikTok API error ${res.error.code}: ${res.error.message}`);
  return res.data;
}

export function normalizeTikTok(v: TikTokVideo): MetricsResult["metrics"] {
  return metrics({ views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count });
}

export class TikTokOwnProvider implements OwnAnalyticsProvider {
  readonly platform = "tiktok" as const;

  private post<T>(path: string, token: string, account: AccountRef, body: unknown) {
    return fetchJson<TikTokEnvelope<T>>(`${API}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      limitKey: `tiktok:${account.id}`,
    }).then(unwrap);
  }

  async listRecentPosts(account: AccountRef, token: string, limit: number): Promise<OwnPost[]> {
    const out: OwnPost[] = [];
    let cursor: number | undefined;
    while (out.length < limit) {
      const data = await this.post<{ videos: TikTokVideo[]; cursor: number; has_more: boolean }>(
        `/video/list/?fields=${VIDEO_FIELDS}`, token, account,
        { max_count: Math.min(20, limit - out.length), ...(cursor ? { cursor } : {}) },
      );
      for (const v of data.videos) {
        out.push({
          platform_post_id: v.id,
          published_at: new Date(v.create_time * 1000).toISOString(),
          permalink: v.share_url ?? null,
          caption: v.video_description ?? null,
          media_type: "video",
          duration_seconds: v.duration ?? null,
        });
      }
      if (!data.has_more) break;
      cursor = data.cursor;
    }
    return out;
  }

  async fetchPostMetrics(account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult> {
    const data = await this.post<{ videos: TikTokVideo[] }>(
      `/video/query/?fields=${VIDEO_FIELDS}`, token, account, { filters: { video_ids: [post.platform_post_id] } },
    );
    const v = data.videos[0];
    if (!v) throw new Error(`TikTok video ${post.platform_post_id} not found`);
    return { metrics: normalizeTikTok(v), raw: v };
  }

  async fetchAccountMetrics(account: AccountRef, token: string): Promise<AccountMetrics> {
    // follower_count needs the user.info.stats scope; without it the value stays null.
    try {
      const res = await fetchJson<TikTokEnvelope<{ user: { follower_count?: number } }>>(
        `${API}/user/info/?fields=follower_count`,
        { headers: { authorization: `Bearer ${token}` }, limitKey: `tiktok:${account.id}` },
      ).then(unwrap);
      return { followers: res.user.follower_count ?? null, profile_visits: null, raw: res };
    } catch {
      return { followers: null, profile_visits: null, raw: null };
    }
  }

  async fetchComments(): Promise<RawComment[]> {
    return []; // The Display API does not expose comments.
  }
}
