import { fetchJson } from "../../lib/http.js";
import { momentumFromSeries } from "../../signals/momentum.js";
import type { SignalRecord } from "../types.js";

/** Wikimedia REST pageviews: topic momentum for pillar keywords. No key; the User-Agent is set globally. */

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export async function wikipediaMomentum(article: string, lang = "en", now = new Date()): Promise<SignalRecord | null> {
  const end = new Date(now.getTime() - 86_400_000);
  const start = new Date(end.getTime() - 27 * 86_400_000);
  const title = encodeURIComponent(article.trim().replace(/ /g, "_"));
  const res = await fetchJson<{ items: { timestamp: string; views: number }[] }>(
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/user/${title}/daily/${ymd(start)}/${ymd(end)}`,
    { limitKey: "wikimedia" },
  ).catch(() => null);
  if (!res) return null;
  const series = res.items.map((i) => i.views);
  return {
    source: "wikipedia_pageviews",
    topic: article,
    title: article,
    url: `https://${lang}.wikipedia.org/wiki/${title}`,
    geo: null,
    momentum: momentumFromSeries(series),
    payload: { series },
    observed_at: now.toISOString(),
  };
}
