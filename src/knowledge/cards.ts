import { z } from "zod";
import type { Db } from "../db.js";
import { newId } from "../lib/ids.js";

/**
 * Knowledge cards: one fact per card, always with a verbatim source quote.
 * Flexible on purpose: `attributes` holds odd structured facts and `note` is
 * the home for anything that fits no type yet, so nothing is thrown away.
 */

export const CARD_TYPES = [
  "product", "service", "feature", "pricing", "proof", "case_study", "testimonial", "client", "faq", "objection",
  "claim", "disclaimer", "audience", "differentiator", "process", "event", "news", "location", "person", "note",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** What the model returns per fact (structured output). */
export const ExtractedCard = z.object({
  page: z.number().int().describe("0-based index of the page or document part the fact comes from"),
  type: z.enum(CARD_TYPES),
  title: z.string().describe("short label, e.g. the product name, the question, or the stat"),
  body: z.string().describe("the fact in one to three plain sentences"),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })).describe("structured details: price, unit, location, client, metric..."),
  product: z.string().describe("name of the product or service this fact belongs to, or empty for company-wide"),
  quote: z.string().describe("the exact words from the source that support the fact, copied verbatim, max 200 characters"),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ExtractedCard = z.infer<typeof ExtractedCard>;
export const ExtractionOutput = z.object({ cards: z.array(ExtractedCard) });

export interface CardSource { kind: "page" | "upload" | "user" | "research"; ref: string; url: string | null; quote: string }

export interface CardRow {
  id: string; workspace_id: string; type: CardType; title: string; body: string; attributes: Record<string, string>;
  product_ids: string[]; sources: CardSource[]; status: "suggested" | "approved" | "rejected" | "stale";
  confidence: "high" | "medium" | "low"; created_by: "ai" | "user"; used_count: number; first_seen: string; last_verified: string;
}

const normText = (s: string) => s.toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[^\p{L}\p{N}%$€£₦.,:/-]+/gu, " ").replace(/\s+/g, " ").trim();

/**
 * The quote must really be in the source. We accept a quote whose first 60
 * characters (normalised) appear in the text, which tolerates the model trimming the end.
 */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normText(quote);
  if (q.length < 8) return false;
  return normText(source).includes(q.slice(0, 60));
}

/** Validation shared by every extraction path. `sourceText` null = image, can't be checked. */
export function validCards(cards: ExtractedCard[], sourceTexts: (string | null)[]): ExtractedCard[] {
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (!c.title.trim() || !c.quote.trim()) return false;
    const text = sourceTexts[c.page] ?? sourceTexts[0];
    if (text != null && !quoteInSource(c.quote, text)) return false;
    const key = `${c.type}|${normText(c.title)}|${normText(c.body).slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((c) => (sourceTexts[c.page] == null && c.confidence === "high" ? { ...c, confidence: "medium" as const } : c));
}

export interface ProductRef { id: string; name: string }

/** Match a product name loosely (case, punctuation, one containing the other). */
export function matchProduct(name: string, products: ProductRef[]): ProductRef | null {
  const n = normText(name).replace(/[.,:/-]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return null;
  const exact = products.find((p) => normText(p.name) === n);
  if (exact) return exact;
  return products.find((p) => {
    const pn = normText(p.name);
    return pn.length >= 4 && (n.includes(pn) || (n.length >= 4 && pn.includes(n)));
  }) ?? null;
}

async function products(db: Db, ws: string): Promise<ProductRef[]> {
  return (await db.query<ProductRef>("select id, name from products where workspace_id = $1 and status <> 'retired'", [ws])).rows;
}

/**
 * Save validated cards. A card that matches an existing one (same type, very
 * similar text) merges into it: the new source is added and it counts as
 * re-verified. Product and service cards that name something we don't know yet
 * propose a new (unconfirmed) product.
 */
export async function saveCards(
  db: Db, ws: string, cards: ExtractedCard[], source: (c: ExtractedCard) => CardSource, opts: { origin?: "scan" | "upload"; domain?: string | null } = {},
): Promise<{ added: number; merged: number }> {
  let added = 0;
  let merged = 0;
  let known = await products(db, ws);
  for (const c of cards) {
    const src = source(c);
    let product = c.product.trim() ? matchProduct(c.product, known) : null;
    if (!product && (c.type === "product" || c.type === "service") && c.title.trim().length >= 3) {
      const id = newId("prd");
      const r = await db.query<{ id: string }>(
        `insert into products (id, workspace_id, name, kind, origin, confirmed, summary, url, source_domain)
         values ($1,$2,$3,$4,$5,false,$6,$7,$8)
         on conflict (workspace_id, lower(name)) do update set updated_at = now() returning id`,
        [id, ws, c.title.trim().slice(0, 120), c.type === "service" ? "service" : "product", opts.origin ?? "scan", c.body.trim() || null,
          src.url, opts.domain ?? null],
      );
      product = { id: r.rows[0]!.id, name: c.title.trim() };
      known = [...known, product];
    }
    const attributes = Object.fromEntries(c.attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [a.key.trim().slice(0, 60), a.value.trim().slice(0, 200)]));
    const dup = await db.query<{ id: string; sources: CardSource[]; product_ids: string[] }>(
      `select id, sources, product_ids from knowledge_cards
       where workspace_id = $1 and type = $2 and status <> 'rejected'
         and (lower(title) = lower($3) and similarity(body, $4) > 0.5 or similarity(title || ' ' || body, $3 || ' ' || $4) > 0.6)
       order by similarity(title || ' ' || body, $3 || ' ' || $4) desc limit 1`,
      [ws, c.type, c.title.trim(), c.body.trim()],
    );
    const existing = dup.rows[0];
    if (existing) {
      const sources = existing.sources.some((s) => s.ref === src.ref && s.quote === src.quote) ? existing.sources : [...existing.sources, src].slice(-8);
      const productIds = product && !existing.product_ids.includes(product.id) ? [...existing.product_ids, product.id] : existing.product_ids;
      await db.query(
        `update knowledge_cards set sources = $2, product_ids = $3, last_verified = now(),
           status = case when status = 'stale' then 'suggested' else status end, updated_at = now() where id = $1`,
        [existing.id, JSON.stringify(sources), productIds],
      );
      merged++;
      continue;
    }
    await db.query(
      `insert into knowledge_cards (id, workspace_id, type, title, body, attributes, product_ids, sources, confidence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [newId("kc"), ws, c.type, c.title.trim().slice(0, 200), c.body.trim().slice(0, 1200), JSON.stringify(attributes),
        product ? [product.id] : [], JSON.stringify([src]), c.confidence],
    );
    added++;
  }
  return { added, merged };
}

/** Cards from a re-read page whose text changed become stale until re-extracted. */
export async function markStale(db: Db, ws: string, pageId: string): Promise<void> {
  await db.query(
    `update knowledge_cards set status = 'stale', updated_at = now()
     where workspace_id = $1 and status = 'suggested' and sources @> $2::jsonb and jsonb_array_length(sources) = 1`,
    [ws, JSON.stringify([{ ref: pageId }])],
  );
}

// ---------------------------------------------------------------------------
// Coverage: what we know per product, and one question per gap (no AI)
// ---------------------------------------------------------------------------

const COVERAGE: { key: string; types: CardType[]; label: string; question: (p: string) => string }[] = [
  { key: "description", types: ["product", "service", "feature"], label: "What it is", question: (p) => `In one or two sentences, what is ${p} and what does it do?` },
  { key: "pricing", types: ["pricing"], label: "Price or pricing model", question: (p) => `How is ${p} priced (even roughly, or "on request")?` },
  { key: "proof", types: ["proof", "case_study", "testimonial", "client"], label: "Proof", question: (p) => `What result has ${p} delivered for a client? A number, a client name or a short story.` },
  { key: "faq", types: ["faq"], label: "Buyer questions", question: (p) => `What do buyers usually ask before choosing ${p}?` },
  { key: "objection", types: ["objection"], label: "Hesitations", question: (p) => `What makes buyers hesitate about ${p}?` },
  { key: "audience", types: ["audience"], label: "Who it's for", question: (p) => `Who exactly buys ${p}? Role, company type, market.` },
];

export interface CoverageRow { product_id: string; product: string; confirmed: boolean; items: { key: string; label: string; count: number; question: string | null }[]; score: number }

export async function coverage(db: Db, ws: string): Promise<CoverageRow[]> {
  const prods = (await db.query<{ id: string; name: string; confirmed: boolean; summary: string | null; price_text: string | null; audience: string | null }>(
    "select id, name, confirmed, summary, price_text, audience from products where workspace_id = $1 and status <> 'retired' order by confirmed desc, created_at",
    [ws],
  )).rows;
  const counts = (await db.query<{ pid: string; type: CardType; n: number }>(
    `select unnest(product_ids) as pid, type, count(*)::int as n from knowledge_cards
     where workspace_id = $1 and status in ('suggested', 'approved') group by 1, 2`,
    [ws],
  )).rows;
  return prods.map((p) => {
    const items = COVERAGE.map((c) => {
      let count = counts.filter((r) => r.pid === p.id && c.types.includes(r.type)).reduce((s, r) => s + r.n, 0);
      if (c.key === "description" && p.summary) count++;
      if (c.key === "pricing" && p.price_text) count++;
      if (c.key === "audience" && p.audience) count++;
      return { key: c.key, label: c.label, count, question: count ? null : c.question(p.name) };
    });
    return { product_id: p.id, product: p.name, confirmed: p.confirmed, items, score: items.filter((i) => i.count > 0).length / items.length };
  });
}
