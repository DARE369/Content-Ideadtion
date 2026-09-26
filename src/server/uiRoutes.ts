import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { config } from "../config.js";
import type { Db } from "../db.js";
import type { Brief } from "../contracts/brief.js";
import { seedDemoWorkspace } from "../demo/seed.js";
import { shortlist } from "../ideation/cards.js";
import { precomputeWorkspace } from "../ideation/precompute.js";
import { enqueue } from "../jobs/queue.js";
import { probBeatsBaseline } from "../learning/model.js";
import { isTimeout } from "../ai/client.js";
import { addSuggestedCompetitors, CompetitorResearchError, MAX_COMPETITORS, researchCompetitors, type CompetitorSuggestion } from "../research/brand.js";

/**
 * Read models and actions the web app needs on top of the studio API.
 * Everything is scoped by workspace id in the path.
 */
export function registerUiRoutes(app: Hono, db: Db): void {
  app.get("/v1/app-config", (c) =>
    c.json({
      ai_configured: Boolean(config().ANTHROPIC_API_KEY), auth_mode: config().AUTH_MODE,
      youtube_configured: Boolean(config().YOUTUBE_API_KEY), max_competitors: MAX_COMPETITORS,
    }));

  /** Researched competitor suggestions, with which ones are already tracked. */
  app.get("/v1/workspaces/:ws/competitor-suggestions", async (c) => {
    const ws = c.req.param("ws");
    const [s, have] = await Promise.all([
      db.query<{ competitor_suggestions: CompetitorSuggestion[] | null }>("select competitor_suggestions from brand_brains where workspace_id = $1", [ws]),
      db.query<{ name: string }>("select name from competitors where workspace_id = $1", [ws]),
    ]);
    const tracked = new Set(have.rows.map((r) => r.name.toLowerCase()));
    const list = (s.rows[0]?.competitor_suggestions ?? []).map((x) => ({ ...x, tracked: tracked.has(x.name.toLowerCase()) }));
    return c.json({ suggestions: list, tracked: have.rows.length, limit: MAX_COMPETITORS });
  });

  app.post("/v1/workspaces/:ws/competitor-suggestions/refresh", async (c) => {
    if (!config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "Competitor research needs ANTHROPIC_API_KEY on the server." });
    try {
      return c.json({ suggestions: await researchCompetitors(db, c.req.param("ws")) });
    } catch (err) {
      if (err instanceof CompetitorResearchError) throw new HTTPException(503, { message: err.message });
      if (isTimeout(err)) throw new HTTPException(503, { message: "Competitor research took too long this time. Try again in a minute, or add competitors yourself." });
      throw err;
    }
  });

  /** Track chosen suggestions ({names}) or let the AI pick the strongest ({auto: true}), up to the limit. */
  app.post("/v1/workspaces/:ws/competitors/select", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { names?: unknown; auto?: unknown };
    const names = Array.isArray(b.names) ? b.names.filter((n): n is string => typeof n === "string") : undefined;
    if (!b.auto && !names?.length) throw new HTTPException(400, { message: "Pick at least one competitor, or ask the AI to choose." });
    return c.json(await addSuggestedCompetitors(db, c.req.param("ws"), { names, auto: b.auto === true }));
  });

  app.get("/v1/workspaces", async (c) => {
    const r = await db.query(
      `select w.id, w.name, w.created_at, b.confirmed_at is not null as brain_confirmed
       from workspaces w left join brand_brains b on b.workspace_id = w.id order by w.created_at desc`,
    );
    return c.json({ workspaces: r.rows });
  });

  app.patch("/v1/workspaces/:ws", async (c) => {
    const { name } = (await c.req.json()) as { name?: string };
    if (!name?.trim()) throw new HTTPException(400, { message: "name is required" });
    await db.query("update workspaces set name = $2 where id = $1", [c.req.param("ws"), name.trim()]);
    return c.json({ ok: true });
  });

  /** One call for the app shell: setup progress and the counts every screen needs. */
  app.get("/v1/workspaces/:ws/summary", async (c) => {
    const ws = c.req.param("ws");
    const r = await db.query(
      `select w.id, w.name,
         b.workspace_id is not null as brain_exists, b.confirmed_at, b.goal, b.language, b.draft is not null as has_draft,
         (select count(*)::int from competitors where workspace_id = w.id) as competitors,
         (select coalesce(json_agg(distinct platform), '[]') from connected_accounts where workspace_id = w.id and disconnected_at is null) as platforms,
         (select count(*)::int from ideas where workspace_id = w.id and status = 'shortlisted') as shortlisted,
         (select max(created_at) from ideas where workspace_id = w.id and mode = 'give_me_ideas') as ideas_refreshed_at,
         (select count(*)::int from briefs where workspace_id = w.id and status <> 'draft') as briefs,
         (select count(*)::int from briefs where workspace_id = w.id and status = 'queued') as briefs_queued,
         (select count(*)::int from published_posts where workspace_id = w.id) as posts,
         (select count(*)::int from published_posts where workspace_id = w.id and link_status = 'suggested') as pending_matches,
         (select count(*)::int from reports where workspace_id = w.id and kind = 'weekly') as reports,
         (select count(*)::int from jobs where status in ('queued', 'running') and payload->>'workspace_id' = w.id) as jobs_pending
       from workspaces w left join brand_brains b on b.workspace_id = w.id where w.id = $1`,
      [ws],
    );
    if (!r.rows[0]) throw new HTTPException(404, { message: "workspace not found" });
    return c.json(r.rows[0]);
  });

  app.get("/v1/workspaces/:ws/accounts", async (c) =>
    c.json({ accounts: (await db.query(
      `select a.id, a.platform, a.handle, a.account_kind, a.connected_at,
         (select count(*)::int from published_posts p where p.connected_account_id = a.id) as posts,
         (select max(day) from account_metrics_daily m where m.connected_account_id = a.id) as last_metrics_day,
         (select followers from account_metrics_daily m where m.connected_account_id = a.id order by day desc limit 1) as followers
       from connected_accounts a where a.workspace_id = $1 and a.disconnected_at is null order by a.platform`,
      [c.req.param("ws")],
    )).rows }));

  /** Generate a fresh shortlist now (the same pipeline the nightly job runs). */
  app.post("/v1/workspaces/:ws/ideas/generate", async (c) => {
    const ws = c.req.param("ws");
    if (!config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "Idea generation needs ANTHROPIC_API_KEY on the server." });
    const res = await precomputeWorkspace(db, ws);
    if (!res) throw new HTTPException(409, { message: "Confirm the Brand Brain first." });
    return c.json({ ...res, ideas: await shortlist(db, ws, 10) });
  });

  app.get("/v1/workspaces/:ws/briefs", async (c) => {
    const status = c.req.query("status");
    const r = await db.query(
      `select b.id, b.idea_id, b.kind, b.platform, b.status, b.created_at, b.delivered_at, i.title, i.label,
              b.payload->>'format' as format, b.payload->'hooks'->>0 as first_hook
       from briefs b join ideas i on i.id = b.idea_id
       where b.workspace_id = $1 and ($2::text is null or b.status = $2)
       order by b.created_at desc limit 200`,
      [c.req.param("ws"), status ?? null],
    );
    return c.json({ briefs: r.rows });
  });

  app.get("/v1/ideas/:id/briefs", async (c) =>
    c.json({ briefs: (await db.query(
      "select id, kind, platform, status, created_at, payload from briefs where idea_id = $1 order by created_at", [c.req.param("id")],
    )).rows }));

  app.get("/v1/briefs/:id", async (c) => {
    const r = await db.query<{ payload: Brief; status: string; created_at: string; delivered_at: string | null; idea_id: string; title: string }>(
      `select b.payload, b.status, b.created_at, b.delivered_at, b.idea_id, i.title
       from briefs b join ideas i on i.id = b.idea_id where b.id = $1`, [c.req.param("id")],
    );
    if (!r.rows[0]) throw new HTTPException(404, { message: "brief not found" });
    return c.json(r.rows[0]);
  });

  /** Send a draft (e.g. a Refine platform version) to the studio queue. */
  app.post("/v1/briefs/:id/queue", async (c) => {
    const r = await db.query<{ idea_id: string }>(
      "update briefs set status = 'queued' where id = $1 and status = 'draft' returning idea_id", [c.req.param("id")],
    );
    if (r.rows[0]) {
      await db.query("update ideas set status = 'selected' where id = $1 and status in ('candidate', 'shortlisted')", [r.rows[0].idea_id]);
      if (config().STUDIO_WEBHOOK_URL) await enqueue(db, "deliver_brief", { brief_id: c.req.param("id") }, { dedupeKey: `deliver:${c.req.param("id")}` });
    }
    return c.json({ queued: Boolean(r.rows[0]) });
  });

  app.get("/v1/workspaces/:ws/posts", async (c) => {
    const platform = c.req.query("platform");
    const r = await db.query(
      `select p.id, p.platform, p.published_at, p.caption, p.permalink, p.link_status, p.features,
              m.views::float8 as views, m.pi::float8 as pi, m.goal_index::float8 as goal_index, m.views_basis,
              (select views::float8 from metric_snapshots s where s.published_post_id = p.id order by captured_at desc limit 1) as latest_views,
              i.title as idea_title, i.label
       from published_posts p
       left join mv_post_performance m on m.post_id = p.id
       left join ideas i on i.id = p.idea_id
       where p.workspace_id = $1 and ($2::text is null or p.platform = $2)
       order by p.published_at desc limit 200`,
      [c.req.param("ws"), platform ?? null],
    );
    return c.json({ posts: r.rows });
  });

  app.get("/v1/workspaces/:ws/matches", async (c) =>
    c.json({ matches: (await db.query(
      `select p.id, p.platform, p.published_at, p.caption, p.permalink, p.match_confidence::float8 as match_confidence,
              b.id as brief_id, i.title as idea_title, b.payload->>'caption' as brief_caption
       from published_posts p left join briefs b on b.id = p.brief_id left join ideas i on i.id = p.idea_id
       where p.workspace_id = $1 and p.link_status = 'suggested' order by p.published_at desc`,
      [c.req.param("ws")],
    )).rows }));

  app.get("/v1/workspaces/:ws/reports", async (c) =>
    c.json({ reports: (await db.query(
      `select id, period_start, period_end, created_at, body->>'headline' as headline
       from reports where workspace_id = $1 and kind = 'weekly' order by created_at desc limit 52`,
      [c.req.param("ws")],
    )).rows }));

  app.get("/v1/reports/:id", async (c) => {
    const r = await db.query("select id, workspace_id, kind, period_start, period_end, body, input_table, created_at from reports where id = $1", [c.req.param("id")]);
    if (!r.rows[0]) throw new HTTPException(404, { message: "report not found" });
    return c.json(r.rows[0]);
  });

  /** What the learning loop currently believes: rules, test share and the strongest patterns. */
  app.get("/v1/workspaces/:ws/learning", async (c) => {
    const ws = c.req.param("ws");
    const [rules, explore, est] = await Promise.all([
      db.query(
        `select id, platform, feature, value, action, share::float8 as share, rationale, active_until from guidance_rules
         where workspace_id = $1 and active_from <= now() and (active_until is null or active_until > now()) order by active_from desc`, [ws]),
      db.query("select platform, explore_share::float8 as explore_share, reason, updated_at from explore_state where workspace_id = $1", [ws]),
      db.query(
        `select platform, feature, value, n::int as n, mu_hat::float8 as mu_hat, se::float8 as se from v_feature_estimates
         where workspace_id = $1 and n > 0 and feature in ('hook_type', 'format', 'pillar', 'posting_day', 'posting_hour', 'visual_style', 'cta_type')`, [ws]),
    ]);
    const patterns = est.rows
      .map((e) => ({ ...e, p_beat: probBeatsBaseline(e.mu_hat, e.se), multiple: Math.exp(e.mu_hat) }))
      .sort((a, b) => b.p_beat - a.p_beat);
    return c.json({ rules: rules.rows, explore: explore.rows, patterns });
  });

  /** One click to a fully populated workspace for exploring the app. */
  app.post("/v1/demo", async (c) => c.json({ workspace_id: await seedDemoWorkspace(db) }, 201));
}
