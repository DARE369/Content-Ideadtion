import { z } from "zod";
import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { newId } from "../lib/ids.js";
import type { Offer } from "../contracts/brandBrain.js";
import { sha256 } from "./discover.js";

/**
 * Products and services are their own records. Their facts (proof, FAQs,
 * objections, claims, disclaimers) are knowledge cards linked to them. The Brand
 * Brain's `offers` list is derived from here, so ideas, briefs and the Brand
 * Brain form all read the same thing.
 */

export interface ProductRow {
  id: string; workspace_id: string; name: string; kind: "product" | "service"; revenue_role: Offer["revenue_role"] | null;
  status: "active" | "launching" | "seasonal" | "retired"; origin: string; confirmed: boolean; summary: string | null; ai_summary: string | null;
  audience: string | null; price_text: string | null; url: string | null; source_domain: string | null; benefits: string[];
  image_upload_ids: string[]; created_at: string; updated_at: string;
}

export const ProductInput = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["product", "service"]).optional(),
  revenue_role: z.enum(["core", "secondary", "lead_magnet"]).nullable().optional(),
  status: z.enum(["active", "launching", "seasonal", "retired"]).optional(),
  confirmed: z.boolean().optional(),
  summary: z.string().max(2000).nullable().optional(),
  audience: z.string().max(1000).nullable().optional(),
  price_text: z.string().max(200).nullable().optional(),
  url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  benefits: z.array(z.string().max(300)).max(12).optional(),
  image_upload_ids: z.array(z.string()).max(12).optional(),
});
export type ProductInput = z.infer<typeof ProductInput>;

export async function listProducts(db: Db, ws: string, opts: { includeRetired?: boolean } = {}): Promise<(ProductRow & { cards: number })[]> {
  return (await db.query<ProductRow & { cards: number }>(
    `select p.*, (select count(*)::int from knowledge_cards k where k.workspace_id = p.workspace_id and p.id = any(k.product_ids) and k.status in ('suggested','approved')) as cards
     from products p where p.workspace_id = $1 ${opts.includeRetired ? "" : "and p.status <> 'retired'"}
     order by p.confirmed desc, case p.revenue_role when 'core' then 0 when 'secondary' then 1 when 'lead_magnet' then 2 else 3 end, p.created_at`,
    [ws],
  )).rows;
}

export async function createProduct(db: Db, ws: string, input: ProductInput): Promise<ProductRow> {
  const r = await db.query<ProductRow>(
    `insert into products (id, workspace_id, name, kind, revenue_role, status, origin, confirmed, summary, audience, price_text, url, benefits, image_upload_ids)
     values ($1,$2,$3,$4,$5,$6,'user',true,$7,$8,$9,$10,$11,$12)
     on conflict (workspace_id, lower(name)) do update set confirmed = true, status = excluded.status, updated_at = now()
     returning *`,
    [newId("prd"), ws, input.name.trim(), input.kind ?? "product", input.revenue_role ?? null, input.status ?? "active", input.summary ?? null,
      input.audience ?? null, input.price_text ?? null, input.url ?? null, input.benefits ?? [], input.image_upload_ids ?? []],
  );
  return r.rows[0]!;
}

export async function updateProduct(db: Db, ws: string, id: string, input: Partial<ProductInput>): Promise<ProductRow | null> {
  const fields: [string, unknown][] = Object.entries(input).filter(([, v]) => v !== undefined) as [string, unknown][];
  if (!fields.length) return (await db.query<ProductRow>("select * from products where id = $1 and workspace_id = $2", [id, ws])).rows[0] ?? null;
  const sets = fields.map(([k], i) => `${k} = $${i + 3}`).join(", ");
  const r = await db.query<ProductRow>(
    `update products set ${sets}, updated_at = now() where id = $1 and workspace_id = $2 returning *`,
    [id, ws, ...fields.map(([, v]) => v)],
  );
  return r.rows[0] ?? null;
}

/** Remove a suggested product (and unlink its cards); confirmed products are retired instead. */
export async function removeProduct(db: Db, ws: string, id: string): Promise<void> {
  const p = (await db.query<{ confirmed: boolean }>("select confirmed from products where id = $1 and workspace_id = $2", [id, ws])).rows[0];
  if (!p) return;
  if (p.confirmed) {
    await db.query("update products set status = 'retired', updated_at = now() where id = $1", [id]);
    return;
  }
  await db.query("update knowledge_cards set product_ids = array_remove(product_ids, $2) where workspace_id = $1", [ws, id]);
  await db.query("delete from products where id = $1", [id]);
}

/** Offers for prompts and the Brand Brain form: confirmed, not retired, main revenue first. */
export async function offersFromProducts(db: Db, ws: string): Promise<Offer[] | null> {
  const rows = (await db.query<ProductRow>(
    `select * from products where workspace_id = $1 and confirmed and status <> 'retired'
     order by case revenue_role when 'core' then 0 when 'secondary' then 1 when 'lead_magnet' then 2 else 3 end, created_at`,
    [ws],
  )).rows;
  if (!rows.length) return null;
  return rows.map((p) => ({
    name: p.name,
    ...(p.url ? { url: p.url } : {}),
    ...(p.price_text ? { price: p.price_text } : {}),
    ...((p.summary ?? p.ai_summary) ? { description: (p.summary ?? p.ai_summary)!.slice(0, 300) } : {}),
    ...(p.revenue_role ? { revenue_role: p.revenue_role } : {}),
  }));
}

/**
 * When the Brand Brain is saved, its offers list is the user's statement of what
 * they sell: upsert those as confirmed products, retire Brand-Brain products they
 * removed. Products found by scans and not yet confirmed are left alone.
 */
export async function syncProductsFromOffers(db: Db, ws: string, offers: Offer[]): Promise<void> {
  for (const o of offers) {
    await db.query(
      `insert into products (id, workspace_id, name, revenue_role, price_text, url, summary, origin, confirmed)
       values ($1,$2,$3,$4,$5,$6,$7,'brand_brain',true)
       on conflict (workspace_id, lower(name)) do update set revenue_role = excluded.revenue_role, price_text = excluded.price_text,
         url = excluded.url, summary = coalesce(excluded.summary, products.summary), confirmed = true,
         status = case when products.status = 'retired' then 'active' else products.status end, updated_at = now()`,
      [newId("prd"), ws, o.name.trim(), o.revenue_role ?? null, o.price ?? null, o.url ?? null, o.description ?? null],
    );
  }
  const names = offers.map((o) => o.name.trim().toLowerCase());
  await db.query(
    `update products set status = 'retired', updated_at = now()
     where workspace_id = $1 and confirmed and status <> 'retired' and not (lower(name) = any($2))`,
    [ws, names],
  );
}

// ---------------------------------------------------------------------------
// Cached summaries: regenerated only when a product's cards change
// ---------------------------------------------------------------------------

const Summary = z.object({
  summary: z.string().describe("about 80-120 words: what it is, who it's for, the strongest proof, how to start"),
  audience: z.string().describe("who buys it, one line, or empty"),
  benefits: z.array(z.string()).describe("up to 5 short benefits stated in the facts"),
});

export async function refreshProductSummaries(db: Db, ws: string, opts: { max?: number; timeoutMs?: number } = {}): Promise<number> {
  const prods = (await db.query<ProductRow & { summary_hash: string | null }>("select * from products where workspace_id = $1 and status <> 'retired'", [ws])).rows;
  let n = 0;
  const jobs: Promise<void>[] = [];
  for (const p of prods) {
    const cards = (await db.query<{ id: string; type: string; title: string; body: string; updated_at: string }>(
      `select id, type, title, body, updated_at from knowledge_cards
       where workspace_id = $1 and $2 = any(product_ids) and status in ('suggested','approved') order by type, id limit 40`,
      [ws, p.id],
    )).rows;
    if (cards.length < 2) continue;
    const hash = sha256(cards.map((c) => `${c.id}:${c.updated_at}`).join("|"));
    if (hash === p.summary_hash) continue;
    if (n >= (opts.max ?? 12)) break;
    n++;
    jobs.push((async () => {
      try {
        const out = await structured({
          db, task: "knowledge:summary", workspaceId: ws, tier: "fast",
          system: ["Summarise a product or service for a content team from verified facts only. Never add facts."],
          content: `Product: ${p.name}\n\nFacts:\n${cards.map((c) => `- [${c.type}] ${c.title}: ${c.body}`).join("\n")}`,
          schema: Summary, maxTokens: 700, timeoutMs: opts.timeoutMs ?? 25_000,
        });
        await db.query(
          `update products set ai_summary = $2, summary_hash = $3, audience = coalesce(audience, nullif($4, '')),
             benefits = case when cardinality(benefits) = 0 then $5 else benefits end where id = $1`,
          [p.id, out.summary.trim(), hash, out.audience.trim(), out.benefits.map((b) => b.trim()).filter(Boolean).slice(0, 5)],
        );
      } catch (err) {
        console.warn(`[summary ${p.id}] ${(err as Error).message}`);
      }
    })());
  }
  await Promise.all(jobs);
  return n;
}
