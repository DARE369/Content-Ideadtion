import { fetchJson } from "../../lib/http.js";
import type { SignalRecord } from "../types.js";

/** Stack Exchange search (keyless, 300 requests/day per IP): real questions for B2B and tech niches. */
export async function stackExchangeQuestions(query: string, site = "stackoverflow", days = 30): Promise<SignalRecord[]> {
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  const res = await fetchJson<{ items: { question_id: number; title: string; link: string; score: number; answer_count: number; is_answered: boolean; tags: string[]; creation_date: number }[] }>(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&pagesize=20&fromdate=${from}` +
      `&q=${encodeURIComponent(query)}&site=${encodeURIComponent(site)}`,
    { limitKey: "stackexchange" },
  );
  return res.items.map((q) => ({
    source: "stackexchange",
    topic: query,
    title: q.title,
    url: q.link,
    geo: null,
    momentum: null,
    payload: { score: q.score, answers: q.answer_count, answered: q.is_answered, tags: q.tags, site },
    observed_at: new Date(q.creation_date * 1000).toISOString(),
  }));
}
