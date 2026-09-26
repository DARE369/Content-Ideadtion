import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { CARD_TYPES, coverage } from "../knowledge/cards.js";
import { createProduct, listProducts, ProductInput, refreshProductSummaries, removeProduct, updateProduct } from "../knowledge/products.js";
import {
  addSource, cancelScan, latestScan, listSources, pollScan, previewScan, ScanError, scanPages, scanStatus, selectPages, setSourceStatus, startScan,
} from "../knowledge/scan.js";
import { newId } from "../lib/ids.js";
import { StorageError, storageConfigured } from "../lib/storage.js";
import { createUpload, deleteUpload, listUploads, processUpload, UploadError, uploadLink } from "../knowledge/uploads.js";

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => ({}));
  const r = schema.safeParse(raw);
  if (!r.success) throw new HTTPException(400, { message: r.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") });
  return r.data;
}

const uploadErr = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UploadError) throw new HTTPException(400, { message: err.message });
    if (err instanceof StorageError) throw new HTTPException(503, { message: err.message });
    throw err;
  }
};

const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ScanError) throw new HTTPException(409, { message: err.message });
    throw err;
  }
};

/** Business knowledge: sources, scans, cards, coverage and products. */
export function registerKnowledgeRoutes(app: Hono, db: Db): void {
  // --- Sources ---------------------------------------------------------------------
  app.get("/v1/workspaces/:ws/sources", async (c) => c.json({ sources: await listSources(db, c.req.param("ws")) }));

  app.post("/v1/workspaces/:ws/sources", async (c) => {
    const b = await body(c, z.object({ url: z.string().min(4), role: z.enum(["product_site", "shop", "sister_brand", "link_in_bio", "other"]).default("other") }));
    try {
      return c.json(await addSource(db, c.req.param("ws"), b.url, b.role, "user"));
    } catch (err) {
      throw new HTTPException(400, { message: (err as Error).message });
    }
  });

  /** Confirm ("yes, it's ours") or reject a suggested related domain. */
  app.patch("/v1/workspaces/:ws/sources/:id", async (c) => {
    const b = await body(c, z.object({ status: z.enum(["active", "rejected"]) }));
    await setSourceStatus(db, c.req.param("ws"), c.req.param("id"), b.status);
    return c.json({ ok: true });
  });

  // --- Scans -----------------------------------------------------------------------
  /** Discover + fetch + clean (no AI). Returns page counts and the estimated cost. */
  app.post("/v1/workspaces/:ws/scans", async (c) => {
    const b = await body(c, z.object({ extra_urls: z.array(z.string()).max(10).default([]) }));
    return c.json(await wrap(() => previewScan(db, c.req.param("ws"), { extraUrls: b.extra_urls })));
  });

  app.get("/v1/workspaces/:ws/scans/latest", async (c) => c.json({ scan: await latestScan(db, c.req.param("ws")) }));

  app.get("/v1/workspaces/:ws/scans/:id", async (c) => {
    const ws = c.req.param("ws");
    if (config().ANTHROPIC_API_KEY) await pollScan(db, ws, c.req.param("id")).catch((err) => console.warn(`[scan poll] ${(err as Error).message}`));
    return c.json(await wrap(() => scanStatus(db, ws, c.req.param("id"))));
  });

  app.get("/v1/workspaces/:ws/scans/:id/pages", async (c) => c.json({ pages: await scanPages(db, c.req.param("ws"), c.req.param("id")) }));

  app.put("/v1/workspaces/:ws/scans/:id/pages", async (c) => {
    const b = await body(c, z.object({ page_ids: z.array(z.string()) }));
    return c.json(await wrap(() => selectPages(db, c.req.param("ws"), c.req.param("id"), b.page_ids)));
  });

  app.post("/v1/workspaces/:ws/scans/:id/start", async (c) => {
    if (!config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "Reading pages needs ANTHROPIC_API_KEY on the server." });
    return c.json(await wrap(() => startScan(db, c.req.param("ws"), c.req.param("id"))));
  });

  app.post("/v1/workspaces/:ws/scans/:id/cancel", async (c) => {
    await cancelScan(db, c.req.param("ws"), c.req.param("id"));
    return c.json({ ok: true });
  });

  // --- Cards -----------------------------------------------------------------------
  app.get("/v1/workspaces/:ws/cards", async (c) => {
    const ws = c.req.param("ws");
    const status = c.req.query("status");
    const type = c.req.query("type");
    const product = c.req.query("product");
    const q = c.req.query("q");
    const params: unknown[] = [ws];
    const where = ["workspace_id = $1"];
    if (status) { params.push(status.split(",")); where.push(`status = any($${params.length})`); } else where.push("status <> 'rejected'");
    if (type) { params.push(type.split(",")); where.push(`type = any($${params.length})`); }
    if (product === "none") where.push("cardinality(product_ids) = 0");
    else if (product) { params.push(product); where.push(`$${params.length} = any(product_ids)`); }
    if (q) { params.push(`%${q}%`); where.push(`(title ilike $${params.length} or body ilike $${params.length})`); }
    const r = await db.query(
      `select id, type, title, body, attributes, product_ids, sources, status, confidence, created_by, used_count, first_seen, last_verified
       from knowledge_cards where ${where.join(" and ")}
       order by status = 'stale' desc, status = 'suggested' desc, type, last_verified desc limit 500`,
      params,
    );
    const counts = (await db.query<{ status: string; n: number }>("select status, count(*)::int as n from knowledge_cards where workspace_id = $1 group by 1", [ws])).rows;
    return c.json({ cards: r.rows, counts: Object.fromEntries(counts.map((x) => [x.status, x.n])) });
  });

  app.post("/v1/workspaces/:ws/cards", async (c) => {
    const b = await body(c, z.object({
      type: z.enum(CARD_TYPES), title: z.string().min(1).max(200), body: z.string().max(1200).default(""),
      product_ids: z.array(z.string()).default([]), attributes: z.record(z.string(), z.string()).default({}),
    }));
    const id = newId("kc");
    await db.query(
      `insert into knowledge_cards (id, workspace_id, type, title, body, attributes, product_ids, sources, status, confidence, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'approved','high','user')`,
      [id, c.req.param("ws"), b.type, b.title, b.body, JSON.stringify(b.attributes), b.product_ids,
        JSON.stringify([{ kind: "user", ref: "user", url: null, quote: b.title }])],
    );
    return c.json({ id });
  });

  app.patch("/v1/workspaces/:ws/cards/:id", async (c) => {
    const b = await body(c, z.object({
      status: z.enum(["suggested", "approved", "rejected"]).optional(), type: z.enum(CARD_TYPES).optional(),
      title: z.string().min(1).max(200).optional(), body: z.string().max(1200).optional(), product_ids: z.array(z.string()).optional(),
    }));
    const sets: string[] = [];
    const params: unknown[] = [c.req.param("id"), c.req.param("ws")];
    for (const [k, v] of Object.entries(b)) if (v !== undefined) { params.push(v); sets.push(`${k} = $${params.length}`); }
    if (!sets.length) return c.json({ ok: true });
    await db.query(`update knowledge_cards set ${sets.join(", ")}, updated_at = now() where id = $1 and workspace_id = $2`, params);
    return c.json({ ok: true });
  });

  /** Approve or reject many at once (e.g. "approve all from lordswayenergy.com"). */
  app.post("/v1/workspaces/:ws/cards/bulk", async (c) => {
    const b = await body(c, z.object({ ids: z.array(z.string()).max(1000), status: z.enum(["approved", "rejected", "suggested"]) }));
    const r = await db.query("update knowledge_cards set status = $3, updated_at = now() where workspace_id = $1 and id = any($2)", [c.req.param("ws"), b.ids, b.status]);
    return c.json({ updated: r.rowCount });
  });

  /** Merge duplicates: keep the first, absorb the others' sources and products. */
  app.post("/v1/workspaces/:ws/cards/merge", async (c) => {
    const b = await body(c, z.object({ ids: z.array(z.string()).min(2).max(20) }));
    const ws = c.req.param("ws");
    const rows = (await db.query<{ id: string; sources: unknown[]; product_ids: string[] }>(
      "select id, sources, product_ids from knowledge_cards where workspace_id = $1 and id = any($2)", [ws, b.ids],
    )).rows;
    const keep = rows.find((r) => r.id === b.ids[0]);
    if (!keep) throw new HTTPException(404, { message: "card not found" });
    const others = rows.filter((r) => r.id !== keep.id);
    await db.query("update knowledge_cards set sources = $2, product_ids = $3, updated_at = now() where id = $1", [
      keep.id, JSON.stringify([...keep.sources, ...others.flatMap((o) => o.sources)].slice(0, 12)),
      [...new Set([...keep.product_ids, ...others.flatMap((o) => o.product_ids)])],
    ]);
    await db.query("delete from knowledge_cards where id = any($1)", [others.map((o) => o.id)]);
    return c.json({ id: keep.id });
  });

  // --- Uploads ---------------------------------------------------------------------
  app.get("/v1/workspaces/:ws/uploads", async (c) => c.json({ uploads: await listUploads(db, c.req.param("ws")), storage: storageConfigured() }));

  /** Step 1: register the file (by fingerprint) and get a signed URL to PUT it to. */
  app.post("/v1/workspaces/:ws/uploads", async (c) => {
    const b = await body(c, z.object({ filename: z.string().min(1), mime: z.string(), size: z.number().int().nonnegative(), sha256: z.string() }));
    return c.json(await uploadErr(() => createUpload(db, c.req.param("ws"), b)));
  });

  /** Step 2: read it. Text or a downscaled image comes from the browser; scanned PDFs are read from storage. */
  app.post("/v1/workspaces/:ws/uploads/:id/process", async (c) => {
    if (!config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "Reading files needs ANTHROPIC_API_KEY on the server." });
    const b = await body(c, z.object({
      text: z.string().max(400_000).optional(),
      image: z.object({ media_type: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(3_500_000) }).optional(),
      pages: z.number().int().positive().optional(),
      scanned: z.boolean().optional(),
    }));
    return c.json(await uploadErr(() => processUpload(db, c.req.param("ws"), c.req.param("id"), b)));
  });

  app.get("/v1/workspaces/:ws/uploads/:id/link", async (c) => c.json({ url: await uploadLink(db, c.req.param("ws"), c.req.param("id")) }));

  app.delete("/v1/workspaces/:ws/uploads/:id", async (c) => {
    await deleteUpload(db, c.req.param("ws"), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/v1/workspaces/:ws/coverage", async (c) => c.json({ products: await coverage(db, c.req.param("ws")) }));

  // --- Products --------------------------------------------------------------------
  app.get("/v1/workspaces/:ws/products", async (c) =>
    c.json({ products: await listProducts(db, c.req.param("ws"), { includeRetired: c.req.query("all") === "1" }) }));

  app.get("/v1/workspaces/:ws/products/:id", async (c) => {
    const ws = c.req.param("ws");
    const p = (await db.query("select * from products where id = $1 and workspace_id = $2", [c.req.param("id"), ws])).rows[0];
    if (!p) throw new HTTPException(404, { message: "product not found" });
    const cards = (await db.query(
      `select id, type, title, body, attributes, product_ids, sources, status, confidence, created_by, used_count, first_seen, last_verified from knowledge_cards
       where workspace_id = $1 and $2 = any(product_ids) and status <> 'rejected' order by type, last_verified desc`, [ws, p.id],
    )).rows;
    return c.json({ product: p, cards });
  });

  app.post("/v1/workspaces/:ws/products", async (c) => c.json(await createProduct(db, c.req.param("ws"), await body(c, ProductInput))));

  app.patch("/v1/workspaces/:ws/products/:id", async (c) => {
    const p = await updateProduct(db, c.req.param("ws"), c.req.param("id"), await body(c, ProductInput.partial()));
    if (!p) throw new HTTPException(404, { message: "product not found" });
    return c.json(p);
  });

  app.delete("/v1/workspaces/:ws/products/:id", async (c) => {
    await removeProduct(db, c.req.param("ws"), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/v1/workspaces/:ws/products/summaries", async (c) => {
    if (!config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "Summaries need ANTHROPIC_API_KEY on the server." });
    return c.json({ refreshed: await refreshProductSummaries(db, c.req.param("ws")) });
  });
}
