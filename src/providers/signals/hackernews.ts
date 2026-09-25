import { fetchJson } from "../../lib/http.js";
import type { SignalRecord } from "../types.js";

/** Hacker News search (Algolia, keyless). */
export async function hackerNewsStories(query: string, days = 14): Promise<SignalRecord[]> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const res = await fetchJson<{ hits: { objectID: string; title: string; url?: string; points: number; num_comments: number; created_at: string }[] }>(
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=20&query=${encodeURIComponent(query)}&numericFilters=created_at_i>${since}`,
    { limitKey: "hackernews" },
  );
  return res.hits.map((h) => ({
    source: "hackernews",
    topic: query,
    title: h.title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    geo: null,
    momentum: null,
    payload: { points: h.points, comments: h.num_comments, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}` },
    observed_at: h.created_at,
  }));
}
