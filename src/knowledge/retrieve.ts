import type { Db } from "../db.js";

/**
 * Retrieval, not dumping: each ideation run or brief gets at most ~20 of the
 * business's facts, never whole websites. Proof, stories, questions and
 * hesitations are the most useful for content, so they rank first; facts about
 * the products in focus (a campaign's, an objective's) rank higher still.
 */

export interface KnowledgeFact { id: string; type: string; title: string; body: string; product: string | null; url: string | null; status: string }

const TYPE_WEIGHT: Record<string, number> = {
  proof: 5, case_study: 5, testimonial: 4, client: 3, faq: 4, objection: 4, pricing: 3, differentiator: 3, process: 3,
  claim: 2, disclaimer: 2, product: 2, service: 2, feature: 2, audience: 2, event: 2, news: 2, person: 1, location: 1, note: 1,
};

export async function retrieveFacts(db: Db, ws: string, opts: { productIds?: string[]; limit?: number; perType?: number; cardIds?: string[] } = {}): Promise<KnowledgeFact[]> {
  const limit = opts.limit ?? 20;
  const rows = (await db.query<KnowledgeFact & { product_ids: string[]; confidence: string; last_verified: string }>(
    `select k.id, k.type, k.title, k.body, k.product_ids, k.status, k.confidence, k.last_verified,
            (select p.name from products p where p.id = k.product_ids[1]) as product,
            k.sources->0->>'url' as url
     from knowledge_cards k
     where k.workspace_id = $1 and (k.status = 'approved' or (k.status = 'suggested' and k.confidence <> 'low'))
     order by k.last_verified desc limit 400`,
    [ws],
  )).rows;
  const focus = new Set(opts.productIds ?? []);
  const pinned = new Set(opts.cardIds ?? []);
  const scored = rows.map((r) => ({
    r,
    s: (pinned.has(r.id) ? 100 : 0) + (TYPE_WEIGHT[r.type] ?? 1) + (r.product_ids.some((p) => focus.has(p)) ? 4 : 0)
      + (r.status === "approved" ? 2 : 0) + (r.confidence === "high" ? 1 : 0),
  })).sort((a, b) => b.s - a.s);
  const perType = new Map<string, number>();
  const out: KnowledgeFact[] = [];
  for (const { r } of scored) {
    const n = perType.get(r.type) ?? 0;
    if (!pinned.has(r.id) && n >= (opts.perType ?? 4)) continue;
    perType.set(r.type, n + 1);
    out.push({ id: r.id, type: r.type, title: r.title, body: r.body, product: r.product, url: r.url, status: r.status });
    if (out.length >= limit) break;
  }
  return out;
}

export function renderFacts(facts: KnowledgeFact[]): string {
  if (!facts.length) return "";
  return [
    "## Business knowledge: verified facts from the business's own sites and documents. Cite ids. Numbers, prices, client names and claims may ONLY come from here or the evidence tables.",
    "id | type | product | fact",
    ...facts.map((f) => `${f.id} | ${f.type} | ${f.product ?? "company"} | ${f.title}: ${f.body.replace(/\s+/g, " ").slice(0, 260)}`),
  ].join("\n");
}

/** Count real use, so the Knowledge screen can show which facts feed ideas. */
export async function markUsed(db: Db, ws: string, ids: string[]): Promise<void> {
  const kc = ids.filter((i) => i.startsWith("kc_"));
  if (kc.length) await db.query("update knowledge_cards set used_count = used_count + 1 where workspace_id = $1 and id = any($2)", [ws, kc]);
}
