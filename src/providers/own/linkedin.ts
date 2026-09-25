import { config } from "../../config.js";
import { fetchJson } from "../../lib/http.js";
import {
  metrics, type AccountMetrics, type AccountRef, type MetricsResult, type OwnAnalyticsProvider,
  type OwnPost, type RawComment,
} from "../types.js";

/**
 * LinkedIn:
 *  - personal profiles: Member Post Analytics API (scope r_member_postAnalytics)
 *  - organisation pages: organizationalEntityShareStatistics (Community Management API)
 * Member posts are not listed here: they arrive through the studio's published_post
 * records, which already carry the post URN.
 */

const API = "https://api.linkedin.com/rest";

function headers(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "LinkedIn-Version": config().LINKEDIN_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

// Member analytics are fetched one metric type at a time.
export const MEMBER_QUERY_TYPES = {
  IMPRESSION: "views",
  MEMBERS_REACHED: "reach",
  REACTION: "likes",
  COMMENT: "comments",
  RESHARE: "shares",
} as const;

export function normalizeLinkedInOrg(s: {
  impressionCount?: number; uniqueImpressionsCount?: number; likeCount?: number;
  commentCount?: number; shareCount?: number; clickCount?: number;
}): MetricsResult["metrics"] {
  return metrics({
    views: s.impressionCount,
    reach: s.uniqueImpressionsCount,
    likes: s.likeCount,
    comments: s.commentCount,
    shares: s.shareCount,
    link_clicks: s.clickCount,
  });
}

const isOrg = (a: AccountRef) => a.account_kind === "organization" || a.account_kind === "page";

export class LinkedInOwnProvider implements OwnAnalyticsProvider {
  readonly platform = "linkedin" as const;

  async listRecentPosts(account: AccountRef, token: string, limit: number): Promise<OwnPost[]> {
    if (!isOrg(account)) return [];
    const author = encodeURIComponent(`urn:li:organization:${account.external_account_id}`);
    const res = await fetchJson<{ elements: { id: string; commentary?: string; publishedAt?: number; createdAt: number }[] }>(
      `${API}/posts?q=author&author=${author}&count=${Math.min(limit, 50)}`,
      { headers: headers(token), limitKey: `linkedin:${account.id}` },
    );
    return res.elements.map((p) => ({
      platform_post_id: p.id,
      published_at: new Date(p.publishedAt ?? p.createdAt).toISOString(),
      permalink: `https://www.linkedin.com/feed/update/${p.id}`,
      caption: p.commentary ?? null,
      media_type: null,
      duration_seconds: null,
    }));
  }

  async fetchPostMetrics(account: AccountRef, token: string, post: OwnPost): Promise<MetricsResult> {
    const key = `linkedin:${account.id}`;
    if (isOrg(account)) {
      const org = encodeURIComponent(`urn:li:organization:${account.external_account_id}`);
      const list = post.platform_post_id.startsWith("urn:li:ugcPost") ? "ugcPosts" : "shares";
      const res = await fetchJson<{ elements: { totalShareStatistics: Parameters<typeof normalizeLinkedInOrg>[0] }[] }>(
        `${API}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${org}` +
          `&${list}=List(${encodeURIComponent(post.platform_post_id)})`,
        { headers: headers(token), limitKey: key },
      );
      return { metrics: normalizeLinkedInOrg(res.elements[0]?.totalShareStatistics ?? {}), raw: res };
    }
    const values: Record<string, number> = {};
    const raw: Record<string, unknown> = {};
    const entityType = post.platform_post_id.startsWith("urn:li:ugcPost") ? "ugc" : "share";
    for (const [queryType, field] of Object.entries(MEMBER_QUERY_TYPES)) {
      const res = await fetchJson<{ elements: { count: number }[] }>(
        `${API}/memberCreatorPostAnalytics?q=entity&entity=(${entityType}:${encodeURIComponent(post.platform_post_id)})` +
          `&queryType=${queryType}&aggregation=TOTAL`,
        { headers: headers(token), limitKey: key },
      ).catch(() => null);
      raw[queryType] = res;
      const count = res?.elements[0]?.count;
      if (typeof count === "number") values[field] = count;
    }
    return { metrics: metrics(values), raw };
  }

  async fetchAccountMetrics(account: AccountRef, token: string): Promise<AccountMetrics> {
    if (!isOrg(account)) return { followers: null, profile_visits: null, raw: null };
    const org = encodeURIComponent(`urn:li:organization:${account.external_account_id}`);
    const res = await fetchJson<{ firstDegreeSize?: number }>(
      `${API}/networkSizes/${org}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`,
      { headers: headers(token), limitKey: `linkedin:${account.id}` },
    ).catch(() => ({}) as { firstDegreeSize?: number });
    return { followers: res.firstDegreeSize ?? null, profile_visits: null, raw: res };
  }

  async fetchComments(account: AccountRef, token: string, platformPostId: string): Promise<RawComment[]> {
    const res = await fetchJson<{ elements: { id?: string; $URN?: string; message?: { text: string }; created?: { time: number } }[] }>(
      `${API}/socialActions/${encodeURIComponent(platformPostId)}/comments?count=100`,
      { headers: headers(token), limitKey: `linkedin:${account.id}` },
    ).catch(() => ({ elements: [] }));
    return res.elements
      .filter((c) => c.message?.text)
      .map((c) => ({
        platform_comment_id: c.id ?? c.$URN ?? "",
        text: c.message!.text,
        like_count: null,
        published_at: c.created ? new Date(c.created.time).toISOString() : null,
      }));
  }
}
