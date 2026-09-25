import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../../lib/http.js";
import { momentumFromTraffic, parseApproxTraffic } from "../../signals/momentum.js";
import type { SignalRecord } from "../types.js";

/** Public "Trending now" RSS feed per country. No key. */

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });

interface RssItem {
  title: string;
  approx_traffic?: string;
  pubDate?: string;
  news_item?: { news_item_title?: string; news_item_url?: string } | { news_item_title?: string; news_item_url?: string }[];
}

export function parseTrendsRss(xml: string, geo: string): SignalRecord[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = doc.rss?.channel?.item;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  return items.map((it) => {
    const news = it.news_item ? (Array.isArray(it.news_item) ? it.news_item : [it.news_item]) : [];
    const traffic = parseApproxTraffic(it.approx_traffic);
    return {
      source: "google_trends_rss",
      topic: String(it.title).trim(),
      title: String(it.title).trim(),
      url: news[0]?.news_item_url ?? null,
      geo,
      momentum: momentumFromTraffic(traffic),
      payload: { approx_traffic: traffic, news: news.map((n) => ({ title: n.news_item_title, url: n.news_item_url })) },
      observed_at: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
    } satisfies SignalRecord;
  });
}

export async function fetchTrendingNow(geo: string): Promise<SignalRecord[]> {
  const xml = await fetchText(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, { limitKey: "google_trends" });
  return parseTrendsRss(xml, geo);
}
