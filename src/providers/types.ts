import type { Platform } from "../types.js";

/**
 * Every data source sits behind these interfaces, so a paid vendor added later
 * is a new implementation registered in config — it adds data, never replaces it.
 */

/** Normalised metric model. Null means the platform does not provide it; never guessed. */
export interface NormalizedMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  sends: number | null;
  avg_watch_seconds: number | null;
  completion_rate: number | null;
  link_clicks: number | null;
  profile_visits: number | null;
  followers_gained: number | null;
}

export const EMPTY_METRICS: NormalizedMetrics = {
  views: null, reach: null, likes: null, comments: null, shares: null, saves: null, sends: null,
  avg_watch_seconds: null, completion_rate: null, link_clicks: null, profile_visits: null, followers_gained: null,
};

export function metrics(partial: Partial<NormalizedMetrics>): NormalizedMetrics {
  const out = { ...EMPTY_METRICS };
  for (const [k, v] of Object.entries(partial) as [keyof NormalizedMetrics, number | null | undefined][]) {
    out[k] = v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v);
  }
  return out;
}

export interface AccountRef {
  id: string; // acc_...
  platform: Platform;
  external_account_id: string;
  handle: string | null;
  account_kind: string;
  studio_connection_id: string;
}

export interface OwnPost {
  platform_post_id: string;
  published_at: string;
  permalink: string | null;
  caption: string | null;
  media_type: string | null;
  duration_seconds: number | null;
}

export interface MetricsResult {
  metrics: NormalizedMetrics;
  raw: unknown;
}

export interface AccountMetrics {
  followers: number | null;
  profile_visits: number | null;
  raw: unknown;
}

export interface RawComment {
  platform_comment_id: string;
  text: string;
  like_count: number | null;
  published_at: string | null;
}

/** The studio owns OAuth tokens; we ask it for a fresh one per call. */
export interface TokenResolver {
  accessToken(account: AccountRef): Promise<string>;
}

export interface OwnAnalyticsProvider {
  readonly platform: Platform;
  listRecentPosts(account: AccountRef, token: string, limit: number): Promise<OwnPost[]>;
  fetchPostMetrics(account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult>;
  fetchAccountMetrics(account: AccountRef, token: string): Promise<AccountMetrics>;
  fetchComments(account: AccountRef, token: string, platformPostId: string): Promise<RawComment[]>;
}

export interface CompetitorPostRecord {
  platform: Platform;
  platform_post_id: string;
  permalink: string | null;
  title: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  source_url: string;
}

export interface CompetitorProvider {
  readonly platform: Platform;
  /** Most recent posts of a public account (up to ~30, enough for the outlier median). */
  recentPosts(handle: string, ctx: { viaAccount?: AccountRef; token?: string }): Promise<CompetitorPostRecord[]>;
}

export interface SignalRecord {
  source:
    | "google_trends_rss" | "wikipedia_pageviews" | "youtube_most_popular" | "own_comments"
    | "competitor_comments" | "stackexchange" | "hackernews" | "tiktok_oembed" | "claude_web_search";
  topic: string;
  title: string | null;
  url: string | null;
  geo: string | null;
  momentum: number | null;
  payload: Record<string, unknown>;
  observed_at: string;
}
