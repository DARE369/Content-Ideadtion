import { fetchJson } from "../../lib/http.js";
import type { CompetitorPostRecord } from "../types.js";

/** Keyless TikTok oEmbed for links the user pastes: caption, author and cover. No metrics. */
export async function tiktokOembed(url: string): Promise<CompetitorPostRecord> {
  if (!/^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//.test(url)) throw new Error("not a TikTok URL");
  const res = await fetchJson<{ title?: string; author_name?: string; thumbnail_url?: string; embed_product_id?: string }>(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    { limitKey: "tiktok_oembed" },
  );
  return {
    platform: "tiktok",
    platform_post_id: res.embed_product_id ?? url,
    permalink: url,
    title: res.author_name ?? null,
    caption: res.title ?? null,
    thumbnail_url: res.thumbnail_url ?? null,
    media_type: "video",
    published_at: null,
    views: null,
    likes: null,
    comments: null,
    source_url: url,
  };
}
