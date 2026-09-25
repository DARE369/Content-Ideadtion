import { config } from "../../config.js";
import { HttpError, fetchJson } from "../../lib/http.js";
import type { AccountRef, CompetitorPostRecord, CompetitorProvider } from "../types.js";

/**
 * Instagram Business Discovery, called with the user's own connected professional
 * account (Instagram API with Facebook Login only). Public professional accounts
 * only; age-gated accounts are excluded by Meta. Counts against the 200 calls/user/hour.
 */

interface DiscoveryMedia {
  id: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  view_count?: number;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  media_url?: string;
  thumbnail_url?: string;
}

const MEDIA_FIELDS = "id,caption,like_count,comments_count,view_count,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url";
const MEDIA_FIELDS_FALLBACK = "id,caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp";

export function mapDiscoveryMedia(handle: string, media: DiscoveryMedia[]): CompetitorPostRecord[] {
  return media.map((m) => ({
    platform: "instagram",
    platform_post_id: m.id,
    permalink: m.permalink ?? null,
    title: null,
    caption: m.caption ?? null,
    thumbnail_url: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url ?? null : null),
    media_type: m.media_product_type ?? m.media_type ?? null,
    published_at: m.timestamp ?? null,
    views: m.view_count ?? null,
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
    source_url: m.permalink ?? `https://www.instagram.com/${handle}/`,
  }));
}

export class InstagramBusinessDiscovery implements CompetitorProvider {
  readonly platform = "instagram" as const;

  async recentPosts(handle: string, ctx: { viaAccount?: AccountRef; token?: string }): Promise<CompetitorPostRecord[]> {
    if (!ctx.viaAccount || !ctx.token) throw new Error("Business Discovery needs the user's connected Instagram professional account");
    const base = `https://graph.facebook.com/${config().META_GRAPH_VERSION}/${ctx.viaAccount.external_account_id}`;
    const call = (fields: string) =>
      fetchJson<{ business_discovery: { media?: { data: DiscoveryMedia[] } } }>(
        `${base}?fields=business_discovery.username(${encodeURIComponent(handle)}){followers_count,media_count,media.limit(30){${fields}}}` +
          `&access_token=${ctx.token}`,
        { limitKey: `instagram:${ctx.viaAccount!.id}` },
      );
    let res;
    try {
      res = await call(MEDIA_FIELDS);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 400) throw err;
      res = await call(MEDIA_FIELDS_FALLBACK);
    }
    return mapDiscoveryMedia(handle, res.business_discovery.media?.data ?? []);
  }
}
