import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { submitBatch, type BatchItem } from "../ai/batch.js";
import { sha256, wellFormed } from "./discover.js";
import { ExtractionOutput, saveCards, validCards, type ExtractedCard } from "./cards.js";

/**
 * Turning page text and documents into knowledge cards. Cheapest path first:
 * a cached extraction for the same text (free), then Haiku in real time for the
 * few pages a person is waiting on, then the Batch API (50% off) for the rest.
 */

/** Bump when the extraction prompt or schema changes; old results are then re-extracted once. */
export const PROMPT_VERSION = "kc-1";
export const PAGES_PER_REQUEST = 4;

export const EXTRACT_ROLE = `You extract facts a business's content team can use in social posts, from the business's own web pages and documents.

Rules:
- Only facts stated in the source. Never infer prices, numbers, clients or claims.
- One fact per card. Types: product, service, feature, pricing, proof (results, numbers, awards, certifications), case_study, testimonial, client, faq (question in title, answer in body), objection (a hesitation the business addresses), claim (a marketing claim the business makes), disclaimer, audience (who it's for), differentiator, process (how it works / how to start), event, news, location, person (a named leader or expert), note (useful but fits nothing else).
- "product" = the exact product or service name the fact belongs to, or empty for company-wide facts.
- "quote" = words copied exactly from the source (max 200 characters) that support the fact.
- Skip navigation, cookie notices, legal text, generic slogans with no substance, and anything repeated from an earlier card.
- Up to 15 cards per page; fewer is fine for thin pages.`;

export interface ExtractUnit { id: string; hash: string; title: string | null; url: string | null; text: string | null; image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string }; document?: { data: string } }

export const cacheKey = (hash: string) => sha256(`${hash}:${PROMPT_VERSION}`);

export function unitContent(units: ExtractUnit[]): Anthropic.MessageParam["content"] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  units.forEach((u, i) => {
    blocks.push({ type: "text", text: wellFormed(`### Source ${i}${u.title ? `: ${u.title}` : ""}${u.url ? ` (${u.url})` : ""}`) });
    if (u.image) blocks.push({ type: "image", source: { type: "base64", media_type: u.image.media_type, data: u.image.data } });
    else if (u.document) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: u.document.data } });
    else blocks.push({ type: "text", text: wellFormed(u.text ?? "") || "(empty)" });
  });
  blocks.push({ type: "text", text: `Extract the cards. "page" is the Source number (0 to ${units.length - 1}).` });
  return blocks;
}

/** Cached extraction results for these hashes: {hash -> cards}. */
export async function cachedExtractions(db: Db, hashes: string[]): Promise<Map<string, ExtractedCard[]>> {
  if (!hashes.length) return new Map();
  const keys = hashes.map(cacheKey);
  const r = await db.query<{ key: string; result: { cards: ExtractedCard[] } }>("select key, result from extractions where key = any($1)", [keys]);
  const byKey = new Map(r.rows.map((x) => [x.key, x.result.cards]));
  return new Map(hashes.filter((h) => byKey.has(cacheKey(h))).map((h) => [h, byKey.get(cacheKey(h))!]));
}

export async function storeExtraction(db: Db, hash: string, cards: ExtractedCard[]): Promise<void> {
  await db.query(
    "insert into extractions (key, result) values ($1, $2) on conflict (key) do update set result = excluded.result",
    [cacheKey(hash), JSON.stringify({ cards: cards.map((c) => ({ ...c, page: 0 })) })],
  );
}

/** Split a multi-source result per source, validate against each text, re-index to 0. */
export function splitByUnit(out: ExtractedCard[], units: ExtractUnit[]): ExtractedCard[][] {
  return units.map((u, i) => validCards(out.filter((c) => c.page === i).map((c) => ({ ...c, page: 0 })), [u.image || u.document ? null : u.text]));
}

/** Real-time extraction for a small group of units (Haiku). */
export async function extractNow(db: Db, ws: string, units: ExtractUnit[], task: string, timeoutMs = 45_000): Promise<ExtractedCard[][]> {
  const out = await structured({
    db, task, workspaceId: ws, tier: "fast",
    system: [EXTRACT_ROLE],
    content: unitContent(units),
    schema: ExtractionOutput,
    maxTokens: 1_800 * units.length + 1_000,
    timeoutMs,
  });
  const per = splitByUnit(out.cards, units);
  await Promise.all(units.map((u, i) => storeExtraction(db, u.hash, per[i]!)));
  return per;
}

/** Queue the rest through the Batch API. Returns the batch id and which units each request carries. */
export async function extractInBatch(db: Db, ws: string, groupsOfUnits: ExtractUnit[][], customPrefix: string): Promise<{ batchId: string | null; groups: Record<string, string[]> }> {
  const groups: Record<string, string[]> = {};
  const items: BatchItem[] = groupsOfUnits.map((units, n) => {
    const id = `${customPrefix}-${n}`;
    groups[id] = units.map((u) => u.id);
    return { custom_id: id, content: unitContent(units) };
  });
  const batchId = await submitBatch(db, {
    task: "knowledge:extract:batch", handler: "knowledge_cards", tier: "fast", system: [EXTRACT_ROLE],
    schema: ExtractionOutput, items, workspaceId: ws, maxTokens: 1_800 * PAGES_PER_REQUEST + 1_000,
  });
  return { batchId, groups };
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export { saveCards };
