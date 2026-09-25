import { timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { BudgetExceededError, RefusalError } from "../ai/client.js";
import { confirmMatch, registerPublishedPost } from "../analytics/ingest.js";
import { latestReport, overview, postDetail } from "../analytics/queries.js";
import { BrandBrain } from "../contracts/brandBrain.js";
import type { Brief } from "../contracts/brief.js";
import { autopilot, handOff } from "../handoff/briefs.js";
import { confirmBrandBrain, draftBrandBrain } from "../ideation/brandBrain.js";
import { ideaCard, shortlist } from "../ideation/cards.js";
import { connectedPlatforms } from "../ideation/context.js";
import { exportBrief, exportIdeas, type ExportFormat } from "../ideation/export.js";
import { refineIdea } from "../ideation/refine.js";
import { enqueue } from "../jobs/queue.js";
import { drainFor, requeueStuck, tickSchedule, tokenResolver } from "../jobs/runner.js";
import { newId } from "../lib/ids.js";
import { deleteWorkspace, disconnectAccount } from "../privacy/deletion.js";
import { tiktokOembed } from "../providers/competitor/tiktokOembed.js";
import { storeSignals } from "../signals/ingest.js";
import { GOALS, PLATFORMS } from "../types.js";

/**
 * The ideation service API. The studio is the only caller (server to server,
 * Bearer API_TOKEN); the Idea Cards and analytics pages are studio routes that
 * read these endpoints.
 */

/** Leave headroom under the function limit (vercel.json maxDuration = 300). */
const CRON_BUDGET_MS = Number(process.env.CRON_BUDGET_MS ?? 240_000);

const Format = z.enum(["md", "json", "csv"]).default("md");
const CONTENT_TYPES: Record<ExportFormat, string> = { md: "text/markdown; charset=utf-8", json: "application/json", csv: "text/csv; charset=utf-8" };

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "body must be JSON" });
  }
  return schema.parse(json);
}

function authorized(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function createApp(db: Db): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ ok: true }));

  /**
   * Serverless scheduler: Vercel Cron (or any external cron) calls this with
   * `Authorization: Bearer CRON_SECRET`. It enqueues due recurring work, then
   * drains the queue within the function's time budget.
   */
  app.get("/cron/tick", async (c) => {
    const secret = config().CRON_SECRET;
    if (!secret || !authorized(c.req.header("authorization"), secret)) throw new HTTPException(401, { message: "unauthorized" });
    await requeueStuck(db);
    await tickSchedule(db);
    const ran = await drainFor(db, tokenResolver(), CRON_BUDGET_MS);
    return c.json({ ran });
  });

  app.use("/v1/*", async (c, next) => {
    const token = config().API_TOKEN;
    if (!token) throw new HTTPException(500, { message: "API_TOKEN is not configured" });
    if (!authorized(c.req.header("authorization"), token)) throw new HTTPException(401, { message: "unauthorized" });
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ZodError) return c.json({ error: "invalid request", issues: err.issues }, 400);
    if (err instanceof BudgetExceededError) return c.json({ error: err.message }, 429);
    if (err instanceof RefusalError) return c.json({ error: err.message }, 422);
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  // --- Workspaces and the Brand Brain ------------------------------------------------

  app.post("/v1/workspaces", async (c) => {
    const b = await body(c, z.object({ studio_workspace_id: z.string().min(1), name: z.string().min(1) }));
    const r = await db.query<{ id: string }>(
      `insert into workspaces (id, studio_workspace_id, name) values ($1,$2,$3)
       on conflict (studio_workspace_id) do update set name = excluded.name returning id`,
      [newId("wsp"), b.studio_workspace_id, b.name],
    );
    return c.json({ workspace_id: r.rows[0]!.id }, 201);
  });

  app.delete("/v1/workspaces/:ws", async (c) => {
    await deleteWorkspace(db, c.req.param("ws"));
    return c.body(null, 204);
  });

  app.post("/v1/workspaces/:ws/brand-brain/draft", async (c) => {
    const b = await body(c, z.object({ website_url: z.string().url(), goal: z.enum(GOALS), language: z.string().min(2) }));
    return c.json(await draftBrandBrain(db, c.req.param("ws"), b));
  });

  app.put("/v1/workspaces/:ws/brand-brain", async (c) => {
    const b = await body(c, BrandBrain.extend({ timezone: z.string().optional(), trends_geo: z.string().length(2).nullable().optional() }));
    await confirmBrandBrain(db, c.req.param("ws"), b);
    await enqueue(db, "nightly_workspace", { workspace_id: c.req.param("ws") }, { dedupeKey: `nightly:${c.req.param("ws")}` });
    return c.json({ confirmed: true });
  });

  app.get("/v1/workspaces/:ws/brand-brain", async (c) => {
    const r = await db.query("select * from brand_brains where workspace_id = $1", [c.req.param("ws")]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "no brand brain" });
    return c.json(r.rows[0]);
  });

  // --- Connected accounts and competitors ----------------------------------------------

  app.post("/v1/workspaces/:ws/accounts", async (c) => {
    const b = await body(c, z.object({
      platform: z.enum(PLATFORMS), external_account_id: z.string(), handle: z.string().nullable().optional(),
      account_kind: z.enum(["personal", "business", "creator", "page", "organization", "channel"]).default("personal"),
      studio_connection_id: z.string(),
    }));
    const id = newId("acc");
    const r = await db.query<{ id: string }>(
      `insert into connected_accounts (id, workspace_id, platform, external_account_id, handle, account_kind, studio_connection_id)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (platform, external_account_id, workspace_id) do update set disconnected_at = null,
         studio_connection_id = excluded.studio_connection_id, account_kind = excluded.account_kind
       returning id`,
      [id, c.req.param("ws"), b.platform, b.external_account_id, b.handle ?? null, b.account_kind, b.studio_connection_id],
    );
    const accountId = r.rows[0]!.id;
    await enqueue(db, "backfill_account", { account_id: accountId }, { dedupeKey: `backfill:${accountId}` });
    return c.json({ account_id: accountId }, 201);
  });

  app.delete("/v1/accounts/:id", async (c) => c.json({ deleted: await disconnectAccount(db, c.req.param("id")) }));

  app.post("/v1/workspaces/:ws/competitors", async (c) => {
    const b = await body(c, z.object({ name: z.string().min(1), handles: z.partialRecord(z.enum(PLATFORMS), z.string()) }));
    try {
      const id = newId("cmp");
      await db.query("insert into competitors (id, workspace_id, name, handles) values ($1,$2,$3,$4)",
        [id, c.req.param("ws"), b.name, JSON.stringify(b.handles)]);
      return c.json({ competitor_id: id }, 201);
    } catch (err) {
      if (err instanceof Error && err.message.includes("at most 5")) throw new HTTPException(409, { message: err.message });
      throw err;
    }
  });

  app.get("/v1/workspaces/:ws/competitors", async (c) =>
    c.json((await db.query("select id, name, handles from competitors where workspace_id = $1 order by created_at", [c.req.param("ws")])).rows));

  app.delete("/v1/workspaces/:ws/competitors/:id", async (c) => {
    await db.query("delete from competitors where id = $1 and workspace_id = $2", [c.req.param("id"), c.req.param("ws")]);
    return c.body(null, 204);
  });

  /** A TikTok link the user pastes: caption and cover via keyless oEmbed (no metrics). */
  app.post("/v1/workspaces/:ws/tiktok-links", async (c) => {
    const b = await body(c, z.object({ url: z.string().url() }));
    const rec = await tiktokOembed(b.url);
    await storeSignals(db, c.req.param("ws"), [{
      source: "tiktok_oembed", topic: rec.caption ?? b.url, title: rec.caption, url: b.url, geo: null, momentum: null,
      payload: { author: rec.title, thumbnail_url: rec.thumbnail_url }, observed_at: new Date().toISOString(),
    }]);
    return c.json(rec, 201);
  });

  // --- Ideas, Autopilot, Refine ---------------------------------------------------------

  app.get("/v1/workspaces/:ws/ideas", async (c) => {
    const limit = Math.min(10, Math.max(5, Number(c.req.query("limit") ?? 10)));
    const cards = await shortlist(db, c.req.param("ws"), limit);
    const fmt = c.req.query("format");
    if (fmt) {
      const f = Format.parse(fmt);
      return c.body(exportIdeas(cards, f), 200, { "content-type": CONTENT_TYPES[f] });
    }
    return c.json({ ideas: cards });
  });

  app.post("/v1/workspaces/:ws/precompute", async (c) => {
    await enqueue(db, "nightly_workspace", { workspace_id: c.req.param("ws") }, { dedupeKey: `nightly:${c.req.param("ws")}` });
    return c.json({ queued: true }, 202);
  });

  app.get("/v1/ideas/:id", async (c) => {
    const card = await ideaCard(db, c.req.param("id"));
    if (!card) throw new HTTPException(404, { message: "idea not found" });
    return c.json(card);
  });

  app.get("/v1/ideas/:id/export", async (c) => {
    const card = await ideaCard(db, c.req.param("id"));
    if (!card) throw new HTTPException(404, { message: "idea not found" });
    const f = Format.parse(c.req.query("format"));
    return c.body(exportIdeas([card], f), 200, { "content-type": CONTENT_TYPES[f] });
  });

  app.post("/v1/ideas/:id/dismiss", async (c) => {
    await db.query("update ideas set status = 'dismissed' where id = $1", [c.req.param("id")]);
    return c.body(null, 204);
  });

  /** Handoff: platforms selected -> one brief each; none -> one general brief. */
  app.post("/v1/ideas/:id/handoff", async (c) => {
    const b = await body(c, z.object({ platforms: z.array(z.enum(PLATFORMS)).default([]) }));
    return c.json({ briefs: await handOff(db, c.req.param("id"), b.platforms) }, 201);
  });

  app.post("/v1/workspaces/:ws/autopilot", async (c) => {
    const ws = c.req.param("ws");
    return c.json({ briefs: await autopilot(db, ws, await connectedPlatforms(db, ws)) }, 201);
  });

  app.post("/v1/workspaces/:ws/refine", async (c) => {
    const b = await body(c, z.object({ idea: z.string().min(3).max(2000), platforms: z.array(z.enum(PLATFORMS)).default([]) }));
    return streamSSE(c, async (stream) => {
      // Events come from parallel work; chain the writes so they stay ordered and all flush.
      let chain: Promise<void> = Promise.resolve();
      const send = (event: string, data: unknown) => {
        chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }));
      };
      try {
        await refineIdea(db, c.req.param("ws"), b.idea, b.platforms, (e) => send(e.type, e));
      } catch (err) {
        send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      await chain;
    });
  });

  // --- Brief queue (the studio side of the handoff) --------------------------------------

  app.get("/v1/briefs", async (c) => {
    const status = z.enum(["queued", "delivered", "acknowledged", "failed"]).default("queued").parse(c.req.query("status"));
    const r = await db.query(
      `select payload from briefs where status = $1 and ($2::text is null or workspace_id = $2) order by created_at limit 100`,
      [status, c.req.query("workspace_id") ?? null],
    );
    return c.json({ briefs: r.rows.map((x) => x.payload) });
  });

  /** Idempotent: acknowledging twice is fine. */
  app.post("/v1/briefs/:id/ack", async (c) => {
    await db.query("update briefs set status = 'acknowledged' where id = $1 and status <> 'draft'", [c.req.param("id")]);
    return c.body(null, 204);
  });

  app.get("/v1/briefs/:id/export", async (c) => {
    const r = await db.query<{ payload: Brief }>("select payload from briefs where id = $1", [c.req.param("id")]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "brief not found" });
    const f = Format.parse(c.req.query("format"));
    return c.body(exportBrief(r.rows[0].payload, f), 200, { "content-type": CONTENT_TYPES[f] });
  });

  // --- Stage 3 contract and analytics ----------------------------------------------------

  app.post("/v1/published-posts", async (c) => c.json(await registerPublishedPost(db, await c.req.json()), 201));

  app.post("/v1/published-posts/:id/confirm-match", async (c) => {
    const b = await body(c, z.object({ accept: z.boolean() }));
    await confirmMatch(db, c.req.param("id"), b.accept);
    return c.body(null, 204);
  });

  app.get("/v1/workspaces/:ws/analytics/overview", async (c) =>
    c.json(await overview(db, c.req.param("ws"), Number(c.req.query("weeks") ?? 12))));

  app.get("/v1/posts/:id", async (c) => {
    const d = await postDetail(db, c.req.param("id"));
    if (!d) throw new HTTPException(404, { message: "post not found" });
    return c.json(d);
  });

  app.get("/v1/workspaces/:ws/reports/latest", async (c) => {
    const r = await latestReport(db, c.req.param("ws"));
    if (!r) throw new HTTPException(404, { message: "no report yet (the first arrives after 3 posts with results)" });
    return c.json(r);
  });

  /** Run queued jobs now (e.g. right after confirming a Brand Brain while testing). */
  app.post("/v1/jobs/run", async (c) => {
    await requeueStuck(db);
    return c.json({ ran: await drainFor(db, tokenResolver(), CRON_BUDGET_MS) });
  });

  app.get("/v1/workspaces/:ws/costs", async (c) => {
    const r = await db.query(
      `select task, model, count(*)::int as calls, sum(cost_usd)::float8 as cost_usd,
              sum(cache_read_tokens)::int as cache_read_tokens, sum(input_tokens)::int as input_tokens
       from cost_log where workspace_id = $1 and created_at > now() - interval '30 days'
       group by 1, 2 order by cost_usd desc`,
      [c.req.param("ws")],
    );
    return c.json({ last_30_days: r.rows });
  });

  return app;
}
