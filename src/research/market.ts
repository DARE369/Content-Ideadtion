import { z } from "zod";
import type { Db } from "../db.js";
import { isTimeout, research, structured } from "../ai/client.js";
import { brandBrainBlock } from "../ai/prompts/shared.js";
import { loadBrain } from "../ideation/context.js";
import { storeSignals } from "../signals/ingest.js";

/**
 * Market scan: what the brand's buyers are paying attention to right now, found
 * with Claude's web search and stored as cited signals. Free trend feeds say
 * little about niche B2B markets (oil and gas in West Africa, say); this gives
 * every idea a real, linked reason for "why now" and lifts it off low confidence.
 */

export const MARKET_BUDGET = { research: 75_000, structure: 25_000 };
/** A fresh scan is reused for this long, so generating again costs nothing extra. */
const FRESH_HOURS = 20;

export const MARKET_KINDS = ["news", "regulation", "event", "deal", "data", "buyer_question", "competitor_content"] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];

const MARKET_ROLE = `You scan a company's market for its content team. Find what the company's buyers are paying attention to RIGHT NOW (the last 60 days): industry news, regulation and policy, deals and projects, events, new data or reports, questions buyers are asking in forums and comment threads, and what competitors just published. Stay inside the company's industry and markets; skip generic business news. Every item needs a real URL you found and its date. Say which of the company's products each item makes relevant, if any. Write each item down as soon as you find it.`;

const Scan = z.object({
  items: z.array(z.object({
    title: z.string().describe("what happened or what's being asked, as a short headline"),
    url: z.string().describe("the source URL"),
    kind: z.enum(MARKET_KINDS),
    summary: z.string().describe("one sentence on why the company's buyers care"),
    published: z.string().describe("YYYY-MM-DD, or empty if unknown"),
    relevance: z.number().min(0).max(1).describe("how directly this touches the company's buyers and products"),
    product: z.string().describe("exact name of the company's product this makes relevant, or empty"),
  })),
});

export interface MarketScanResult { ok: boolean; found: number; reused: boolean; warning?: string }

/** Recency-weighted relevance, 0..1: items from the last two weeks count fully. */
export function marketMomentum(relevance: number, published: string, now = new Date()): number {
  const t = Date.parse(published);
  const ageDays = Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 86_400_000) : 30;
  const recency = ageDays <= 14 ? 1 : ageDays <= 45 ? 0.8 : ageDays <= 90 ? 0.55 : 0.3;
  return Math.round(Math.max(0, Math.min(1, relevance)) * recency * 100) / 100;
}

export async function scanMarket(db: Db, workspaceId: string, opts: { force?: boolean } = {}): Promise<MarketScanResult> {
  const brain = await loadBrain(db, workspaceId);
  if (!brain) return { ok: false, found: 0, reused: false, warning: "Confirm the Brand Brain first." };
  if (!opts.force) {
    const fresh = await db.query<{ n: number }>(
      `select count(*)::int as n from signals where workspace_id = $1 and source = 'claude_web_search' and fetched_at > now() - make_interval(hours => $2)`,
      [workspaceId, FRESH_HOURS],
    );
    if ((fresh.rows[0]?.n ?? 0) > 0) return { ok: true, found: fresh.rows[0]!.n, reused: true };
  }
  try {
    const notes = await research({
      db, task: "market_scan:research", workspaceId, system: [MARKET_ROLE],
      content: `${brandBrainBlock(brain)}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Find 8-12 items.`,
      maxSearches: 5, maxFetches: 0, timeoutMs: MARKET_BUDGET.research,
    });
    if (!notes.text) return { ok: false, found: 0, reused: false, warning: "The market scan ran out of time; ideas use your Brand Brain only." };
    const out = await structured({
      db, task: "market_scan:structure", workspaceId, tier: "fast",
      system: ["Turn market research notes into a list of items. Keep only items with a real http(s) URL from the notes; never invent a URL or a date."],
      content: notes.text, schema: Scan, timeoutMs: MARKET_BUDGET.structure, maxTokens: 4000,
    });
    const offers = new Map(brain.offers.map((o) => [o.name.toLowerCase(), o.name]));
    const now = new Date();
    const items = out.items.filter((i) => /^https?:\/\/\S+\.\S+/.test(i.url.trim()) && i.title.trim());
    await storeSignals(db, workspaceId, items.map((i) => ({
      source: "claude_web_search" as const,
      topic: i.title.trim(),
      title: i.title.trim(),
      url: i.url.trim(),
      geo: brain.country ?? null,
      momentum: marketMomentum(i.relevance, i.published, now),
      payload: { kind: i.kind, summary: i.summary.trim(), published: i.published || null, product: offers.get(i.product.trim().toLowerCase()) ?? null },
      observed_at: now.toISOString(),
    })));
    return {
      ok: items.length > 0, found: items.length, reused: false,
      ...(items.length ? {} : { warning: "The market scan found nothing recent enough to cite." }),
      ...(!notes.searched ? { warning: "Web search isn't enabled on the Anthropic account, so ideas can't cite current news." } : {}),
    };
  } catch (err) {
    console.warn(`[market scan] ${workspaceId}: ${(err as Error).message}`);
    return { ok: false, found: 0, reused: false, warning: isTimeout(err) ? "The market scan ran out of time; ideas use your Brand Brain only." : "The market scan didn't work this time; ideas use your Brand Brain only." };
  }
}
