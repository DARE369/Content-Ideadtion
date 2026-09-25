import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, seedPost, seedWorkspace } from "./setup.js";
import { calls, fakeAnthropic } from "./fakes.js";
import { setAnthropic } from "../../src/ai/client.js";
import { registerOwnProvider } from "../../src/providers/registry.js";
import { metrics, type OwnAnalyticsProvider } from "../../src/providers/types.js";
import { StaticTokenResolver } from "../../src/providers/tokens.js";
import { RateLimitedError } from "../../src/lib/http.js";
import { runDueSnapshots, refreshPerformance } from "../../src/analytics/ingest.js";
import { precomputeWorkspace, rescoreWorkspace } from "../../src/ideation/precompute.js";
import { weeklyReport, postAutopsy } from "../../src/reports/weekly.js";
import { createApp } from "../../src/server/app.js";
import { resetConfig } from "../../src/config.js";
import { seededRng } from "../../src/lib/stats.js";
import { Brief } from "../../src/contracts/brief.js";

let pool: pg.Pool;
let drop: () => Promise<void>;
let ws: string;
let app: ReturnType<typeof createApp>;
const auth = { authorization: "Bearer test-token", "content-type": "application/json" };
const DAY = 86_400_000;
let limited = false;

const fakeInstagram: OwnAnalyticsProvider = {
  platform: "instagram",
  listRecentPosts: async () => [],
  fetchPostMetrics: async (_a, _t, post) => {
    if (limited) throw new RateLimitedError("instagram:acc_instagram", 120_000);
    return { metrics: metrics({ views: 3000, likes: 150, comments: 12, saves: 30, link_clicks: 40 }), raw: { id: post.platform_post_id } };
  },
  fetchAccountMetrics: async () => ({ followers: 1000, profile_visits: 20, raw: {} }),
  fetchComments: async () => [],
};

beforeAll(async () => {
  process.env.API_TOKEN = "test-token";
  resetConfig();
  ({ pool, drop } = await freshDb());
  ws = await seedWorkspace(pool);
  setAnthropic(fakeAnthropic());
  registerOwnProvider("instagram", fakeInstagram);
  app = createApp(pool);
  // History: 12 instagram posts over the last ~4 weeks; price reveals win.
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    await seedPost(pool, ws, `pst_h${String(i).padStart(2, "0")}`, "instagram", new Date(now - (28 - i * 2) * DAY),
      i % 2 ? 900 : 2500, { hook_type: i % 2 ? "logo_intro" : "price_reveal", format: "reel" });
  }
  await pool.query("insert into audience_comments (id, workspace_id, origin, platform, platform_post_id, platform_comment_id, text, is_question, published_at) values ('cmt_1', $1, 'own', 'instagram', 'x', 'c1', 'How much for a 3 tier cake?', true, now())", [ws]);
  await refreshPerformance(pool);
});

afterAll(async () => drop());

describe("ideation: precompute -> give me ideas -> handoff -> autopilot", () => {
  it("precompute shortlists scored, labelled Idea Cards and drafts autopilot briefs", async () => {
    const res = await precomputeWorkspace(pool, ws, seededRng(7));
    expect(res!.shortlisted).toBeGreaterThanOrEqual(4);
    const r = await app.request(`/v1/workspaces/${ws}/ideas`, { headers: auth });
    expect(r.status).toBe(200);
    const { ideas } = (await r.json()) as { ideas: { label: string; evidence: { id: string; kind: string }[]; score: number; relative: string; platform: string }[] };
    expect(ideas.length).toBeGreaterThanOrEqual(4);
    expect(ideas.length).toBeLessThanOrEqual(10);
    // Instagram has results, so proven ideas exist there; tiktok is cold start (all tests).
    expect(ideas.some((i) => i.label === "proven" && i.platform === "instagram")).toBe(true);
    expect(ideas.filter((i) => i.platform === "tiktok").every((i) => i.label === "test")).toBe(true);
    // Invented evidence ids are dropped; own evidence comes first.
    for (const i of ideas) {
      expect(i.evidence.some((e) => e.id === "pst_invented")).toBe(false);
      if (i.evidence.length > 1) expect(["own_post", "comment"]).toContain(i.evidence[0]!.kind);
    }
    // The critic's rejected idea never shows up.
    const rejected = await pool.query("select count(*)::int as n from ideas where title like 'Idea 11:%'");
    expect(rejected.rows[0].n).toBe(0);
    const drafts = await pool.query("select platform from briefs where status = 'draft' order by platform");
    expect(drafts.rows.map((d) => d.platform)).toEqual(["instagram", "tiktok"]);
    // Model tiering: ideator on the strategy model, critic/adapters on the fast model.
    expect(calls.some((c) => c.model === "claude-sonnet-5")).toBe(true);
    expect(calls.some((c) => c.model === "claude-haiku-4-5")).toBe(true);
  });

  it("autopilot queues the pre-rendered drafts without new model calls", async () => {
    const before = calls.length;
    const started = Date.now();
    const r = await app.request(`/v1/workspaces/${ws}/autopilot`, { method: "POST", headers: auth });
    expect(r.status).toBe(201);
    const { briefs } = (await r.json()) as { briefs: { platform: string }[] };
    expect(briefs.map((b) => b.platform).sort()).toEqual(["instagram", "tiktok"]);
    expect(calls.length).toBe(before);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("handoff: selected platforms -> native platform briefs; none -> one general brief", async () => {
    const idea = (await pool.query("select id from ideas where status = 'shortlisted' order by score desc limit 1")).rows[0].id;
    const r = await app.request(`/v1/ideas/${idea}/handoff`, { method: "POST", headers: auth, body: JSON.stringify({ platforms: ["instagram", "youtube"] }) });
    expect(r.status).toBe(201);
    const { briefs } = (await r.json()) as { briefs: unknown[] };
    expect(briefs).toHaveLength(2);
    for (const b of briefs) {
      const parsed = Brief.parse(b);
      expect(parsed.kind).toBe("platform");
      if (parsed.kind === "platform" && parsed.cta.url) expect(parsed.cta.url).toContain(`utm_campaign=${parsed.brief_id}`);
    }
    const other = (await pool.query("select id from ideas where status = 'shortlisted' order by score asc limit 1")).rows[0].id;
    const g = await app.request(`/v1/ideas/${other}/handoff`, { method: "POST", headers: auth, body: JSON.stringify({ platforms: [] }) });
    const gb = ((await g.json()) as { briefs: unknown[] }).briefs;
    expect(gb).toHaveLength(1);
    expect(Brief.parse(gb[0]).kind).toBe("general");

    const q = await app.request(`/v1/briefs?workspace_id=${ws}`, { headers: auth });
    expect(((await q.json()) as { briefs: unknown[] }).briefs.length).toBeGreaterThanOrEqual(3);
  });

  it("refine streams a verdict, sharpened ideas and platform versions", async () => {
    const r = await app.request(`/v1/workspaces/${ws}/refine`, {
      method: "POST", headers: auth, body: JSON.stringify({ idea: "a video about cake prices", platforms: ["instagram", "tiktok"] }),
    });
    const text = await r.text();
    const events = [...text.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
    expect(events[0]).toBe("verdict_delta");
    expect(events).toContain("verdict_done");
    expect(events).toContain("ideas");
    expect(events.filter((e) => e === "platform_brief")).toHaveLength(2);
    expect(events.at(-1)).toBe("done");
  });
});

describe("analytics: stage-3 intake -> snapshots -> PI -> autopsy -> weekly report -> rules", () => {
  let postId: string;

  it("registers a published post with frozen features and a snapshot schedule", async () => {
    const brief = (await pool.query("select id, idea_id from briefs where platform = 'instagram' and status = 'queued' limit 1")).rows[0];
    const r = await app.request("/v1/published-posts", {
      method: "POST", headers: auth,
      body: JSON.stringify({
        platform_post_id: "ig_new_1", platform: "instagram", workspace_id: ws, brief_id: brief.id, idea_id: brief.idea_id,
        published_at: new Date(Date.now() - 73 * 3_600_000).toISOString(), duration_seconds: 28, caption: "Stop pricing cakes like this",
      }),
    });
    expect(r.status).toBe(201);
    postId = ((await r.json()) as { id: string }).id;
    const p = (await pool.query("select features, link_status from published_posts where id = $1", [postId])).rows[0];
    expect(p.link_status).toBe("linked");
    expect(p.features).toMatchObject({ format: "reel", cta_type: "link_in_bio", length_bucket: "16-30s", language: "en-NG" });
    const jobs = (await pool.query("select offset_label from snapshot_jobs where published_post_id = $1 order by due_at", [postId])).rows.map((x) => x.offset_label);
    expect(jobs).toEqual(expect.arrayContaining(["72h", "7d", "28d"]));
    expect(jobs).not.toContain("1h");
  });

  it("rate limits defer snapshots instead of dropping them", async () => {
    limited = true;
    const tokens = new StaticTokenResolver({ conn_instagram: "tok" });
    const s1 = await runDueSnapshots(pool, tokens);
    expect(s1.deferred).toBeGreaterThan(0);
    const j = (await pool.query("select status, not_before from snapshot_jobs where published_post_id = $1 and offset_label = '72h'", [postId])).rows[0];
    expect(j.status).toBe("pending");
    expect(new Date(j.not_before).getTime()).toBeGreaterThan(Date.now());
    limited = false;
    await pool.query("update snapshot_jobs set not_before = null where published_post_id = $1", [postId]);
    const s2 = await runDueSnapshots(pool, tokens);
    expect(s2.done).toBeGreaterThan(0);
    await refreshPerformance(pool);
    const perf = (await pool.query("select pi::float8 as pi from mv_post_performance where post_id = $1", [postId])).rows[0];
    expect(perf.pi).toBeGreaterThan(1);
    const autopsyJob = await pool.query("select 1 from jobs where kind = 'autopsy' and payload->>'post_id' = $1", [postId]);
    expect(autopsyJob.rowCount).toBe(1);
  });

  it("post autopsy and post detail", async () => {
    expect(await postAutopsy(pool, postId)).toMatch(/^rpt_/);
    const r = await app.request(`/v1/posts/${postId}`, { headers: auth });
    const d = (await r.json()) as { metric_curve: unknown[]; autopsy: unknown; idea_id: string; brief_id: string };
    expect(d.metric_curve.length).toBeGreaterThan(0);
    expect(d.autopsy).not.toBeNull();
    expect(d.idea_id).toMatch(/^ide_/);
  });

  it("weekly report keeps only cited claims and writes structured rules for ideation", async () => {
    const id = await weeklyReport(pool, ws);
    expect(id).toMatch(/^rpt_/);
    const body = (await pool.query("select body from reports where id = $1", [id])).rows[0].body;
    expect(body.what_didnt).toHaveLength(0); // the invented post id was dropped
    expect(body.what_next).toHaveLength(1); // the unknown feature was dropped
    const rules = (await pool.query("select feature, value, action, share::float8 as share from guidance_rules where workspace_id = $1", [ws])).rows;
    expect(rules).toEqual([{ feature: "hook_type", value: "price_reveal", action: "prefer", share: 0.67 }]);
    // Rescoring (no Claude) applies the rule to the shortlist.
    const before = calls.length;
    await rescoreWorkspace(pool, ws, seededRng(3));
    expect(calls.length).toBe(before);
  });

  it("overview headline numbers", async () => {
    const r = await app.request(`/v1/workspaces/${ws}/analytics/overview`, { headers: auth });
    const o = (await r.json()) as { headline: { platform: string; median_now: number }[]; rolling: unknown[] };
    expect(o.headline.find((h) => h.platform === "instagram")!.median_now).toBeGreaterThan(0);
    expect(o.rolling.length).toBeGreaterThan(0);
  });
});

describe("guardrails", () => {
  it("rejects unauthenticated calls", async () => {
    expect((await app.request(`/v1/workspaces/${ws}/ideas`)).status).toBe(401);
  });

  it("caps competitors at 5", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.request(`/v1/workspaces/${ws}/competitors`, { method: "POST", headers: auth, body: JSON.stringify({ name: `c${i}`, handles: { youtube: `@c${i}` } }) });
      expect(r.status).toBe(201);
    }
    const r = await app.request(`/v1/workspaces/${ws}/competitors`, { method: "POST", headers: auth, body: JSON.stringify({ name: "c6", handles: {} }) });
    expect(r.status).toBe(409);
  });

  it("every Claude call is cost-logged and the daily budget is enforced", async () => {
    const log = await pool.query("select count(*)::int as n, sum(cost_usd)::float8 as usd from cost_log where workspace_id = $1", [ws]);
    expect(log.rows[0].n).toBe(calls.length);
    process.env.WORKSPACE_DAILY_BUDGET_USD = String(log.rows[0].usd / 2);
    resetConfig();
    const idea = (await pool.query("select id from ideas where status = 'candidate' limit 1")).rows[0].id;
    const r = await app.request(`/v1/ideas/${idea}/handoff`, { method: "POST", headers: auth, body: JSON.stringify({ platforms: ["linkedin"] }) });
    expect(r.status).toBe(429);
    delete process.env.WORKSPACE_DAILY_BUDGET_USD;
    resetConfig();
  });

  it("disconnecting an account deletes its platform data", async () => {
    const r = await app.request("/v1/accounts/acc_instagram", { method: "DELETE", headers: auth });
    expect(((await r.json()) as { deleted: { posts: number } }).deleted.posts).toBeGreaterThan(10);
    const left = await pool.query("select count(*)::int as n from published_posts where connected_account_id = 'acc_instagram'");
    expect(left.rows[0].n).toBe(0);
  });
});
