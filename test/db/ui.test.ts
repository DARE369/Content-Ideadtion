import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb } from "./setup.js";
import { createApp } from "../../src/server/app.js";
import { resetConfig } from "../../src/config.js";
import { Brief } from "../../src/contracts/brief.js";

let pool: pg.Pool;
let drop: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let ws: string;
const json = { "content-type": "application/json" };
const get = async <T = any>(path: string) => { const r = await app.request(path); expect(r.status, path).toBe(200); return (await r.json()) as T; };

beforeAll(async () => {
  process.env.AUTH_MODE = "open";
  delete process.env.ANTHROPIC_API_KEY;
  resetConfig();
  ({ pool, drop } = await freshDb());
  app = createApp(pool);
});

afterAll(async () => {
  delete process.env.AUTH_MODE;
  resetConfig();
  await drop();
});

describe("demo workspace (no Claude, no platform APIs)", () => {
  it("seeds a complete workspace in one call", async () => {
    const r = await app.request("/v1/demo", { method: "POST" });
    expect(r.status).toBe(201);
    ws = ((await r.json()) as { workspace_id: string }).workspace_id;
    const s = await get(`/v1/workspaces/${ws}/summary`);
    expect(s).toMatchObject({ competitors: 3, pending_matches: 1, reports: 1 });
    expect(s.confirmed_at).not.toBeNull();
    expect(s.platforms.sort()).toEqual(["instagram", "tiktok", "youtube"]);
    expect(s.posts).toBeGreaterThan(40);
  });

  it("serves a scored shortlist with real learned labels and score breakdowns", async () => {
    const { ideas } = await get(`/v1/workspaces/${ws}/ideas`);
    expect(ideas.length).toBeGreaterThanOrEqual(5);
    expect(ideas.some((i: any) => i.label === "proven")).toBe(true);
    expect(ideas[0].score_components).toMatchObject({ F: expect.any(Number) });
  });

  it("autopilot works from the pre-rendered drafts", async () => {
    const r = await app.request(`/v1/workspaces/${ws}/autopilot`, { method: "POST" });
    expect(r.status).toBe(201);
    const { briefs } = (await r.json()) as { briefs: unknown[] };
    expect(briefs).toHaveLength(3);
    for (const b of briefs) Brief.parse(b);
    const list = await get(`/v1/workspaces/${ws}/briefs`);
    expect(list.briefs.filter((b: any) => b.status === "queued")).toHaveLength(3);
    const detail = await get(`/v1/briefs/${list.briefs[0].id}`);
    expect(detail.title).toBeTruthy();
  });

  it("analytics read models", async () => {
    const o = await get(`/v1/workspaces/${ws}/analytics/overview`);
    expect(o.headline.length).toBe(3);
    expect(o.rolling.length).toBeGreaterThan(6);
    const { posts } = await get(`/v1/workspaces/${ws}/posts`);
    expect(posts.some((p: any) => p.pi != null)).toBe(true);
    const post = await get(`/v1/posts/${posts.find((p: any) => p.pi != null).id}`);
    expect(post.metric_curve.length).toBeGreaterThan(3);
    const l = await get(`/v1/workspaces/${ws}/learning`);
    expect(l.rules).toHaveLength(1);
    expect(l.patterns.find((p: any) => p.value === "price_reveal").p_beat).toBeGreaterThan(0.7);
  });

  it("reports cite real posts; the weak claim only appears if something underperformed", async () => {
    const { reports } = await get(`/v1/workspaces/${ws}/reports`);
    const r = await get(`/v1/reports/${reports[0].id}`);
    const ids = new Set(r.input_table.posts.map((p: any) => p.post_id));
    for (const c of [...r.body.what_worked, ...r.body.what_didnt]) for (const id of c.post_ids) expect(ids.has(id)).toBe(true);
    for (const c of r.body.what_didnt) {
      const pis = c.post_ids.map((id: string) => r.input_table.posts.find((p: any) => p.post_id === id).pi);
      expect(pis.reduce((a: number, b: number) => a + b, 0) / pis.length).toBeLessThan(1.2);
    }
  });

  it("match inbox: confirming links the post and freezes features", async () => {
    const { matches } = await get(`/v1/workspaces/${ws}/matches`);
    expect(matches).toHaveLength(1);
    await app.request(`/v1/published-posts/${matches[0].id}/confirm-match`, { method: "POST", headers: json, body: JSON.stringify({ accept: true }) });
    expect((await get(`/v1/workspaces/${ws}/matches`)).matches).toHaveLength(0);
    const p = (await pool.query("select link_status, features from published_posts where id = $1", [matches[0].id])).rows[0];
    expect(p.link_status).toBe("confirmed");
    expect(p.features.hook_type).toBeTruthy();
  });

  it("drafts can be queued once; generate explains a missing key", async () => {
    const draft = (await pool.query("insert into briefs (id, idea_id, workspace_id, kind, platform, payload, status) select 'brf_manual', idea_id, workspace_id, kind, platform, payload, 'draft' from briefs where workspace_id = $1 limit 1 returning id", [ws])).rows[0];
    const q1 = await (await app.request(`/v1/briefs/${draft.id}/queue`, { method: "POST" })).json();
    const q2 = await (await app.request(`/v1/briefs/${draft.id}/queue`, { method: "POST" })).json();
    expect([q1.queued, q2.queued]).toEqual([true, false]);
    const gen = await app.request(`/v1/workspaces/${ws}/ideas/generate`, { method: "POST" });
    expect(gen.status).toBe(503);
    expect(((await get("/v1/app-config")) as any).ai_configured).toBe(false);
  });

  it("workspaces list and rename", async () => {
    await app.request(`/v1/workspaces/${ws}`, { method: "PATCH", headers: json, body: JSON.stringify({ name: "Renamed" }) });
    const { workspaces } = await get("/v1/workspaces");
    expect(workspaces.find((w: any) => w.id === ws)).toMatchObject({ name: "Renamed", brain_confirmed: true });
  });
});
