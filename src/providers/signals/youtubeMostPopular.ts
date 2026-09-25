import { config } from "../../config.js";
import { fetchJson } from "../../lib/http.js";
import type { SignalRecord } from "../types.js";

/** YouTube "most popular" chart by region and category: 1 quota unit per call. */
export async function youtubeMostPopular(regionCode: string, categoryId?: string): Promise<SignalRecord[]> {
  const key = config().YOUTUBE_API_KEY;
  if (!key) return [];
  const cat = categoryId ? `&videoCategoryId=${categoryId}` : "";
  const res = await fetchJson<{
    items: { id: string; snippet: { title: string; channelTitle: string; tags?: string[] }; statistics: { viewCount?: string } }[];
  }>(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&maxResults=25&regionCode=${regionCode}${cat}&key=${key}`,
    { limitKey: "youtube_quota", cost: 1 },
  );
  const now = new Date().toISOString();
  return res.items.map((v, rank) => ({
    source: "youtube_most_popular",
    topic: v.snippet.title,
    title: v.snippet.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    geo: regionCode,
    // Rank on the chart stands in for momentum: #1 -> 1.0, #25 -> ~0.6.
    momentum: 1 - (rank / 25) * 0.4,
    payload: { channel: v.snippet.channelTitle, tags: v.snippet.tags ?? [], views: Number(v.statistics.viewCount ?? 0), category: categoryId ?? null },
    observed_at: now,
  }));
}
