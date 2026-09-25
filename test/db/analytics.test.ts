import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { freshDb, seedPost, seedWorkspace } from "./setup.js";
import { median, percentile } from "../../src/lib/stats.js";
import { loadEstimates } from "../../src/learning/model.js";
import { updateFloorProtection } from "../../src/learning/floor.js";

let pool: pg.Pool;
let drop: () => Promise<void>;
let ws: string;
const DAY = 86_400_000;
const start = new Date("2026-06-01T10:00:00Z").getTime();
// 30 instagram posts, one every 2 days; price reveals do ~2.4x, logo intros ~0.6x.
const views = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 2400 + i * 10 : i % 3 === 1 ? 600 + i * 5 : 1000 + i * 7));
const hook = (i: number) => (i % 3 === 0 ? "price_reveal" : i % 3 === 1 ? "logo_intro" : "question");

beforeAll(async () => {
  ({ pool, drop } = await freshDb());
  ws = await seedWorkspace(pool);
  // Two backfilled history posts (lifetime views) before the tracked ones.
  await seedPost(pool, ws, "pst_hist1", "instagram", new Date(start - 10 * DAY), 5000, {}, { basis: "backfill" });
  await seedPost(pool, ws, "pst_hist2", "instagram", new Date(start - 8 * DAY), 4000, {}, { basis: "backfill" });
  for (const [i, v] of views.entries()) {
    await seedPost(pool, ws, `pst_${String(i).padStart(2, "0")}`, "instagram", new Date(start + i * 2 * DAY), v,
      { hook_type: hook(i), format: "reel" }, { link_clicks: Math.round(v / 100) });
  }
  await pool.query("refresh materialized view mv_post_performance");
});

afterAll(async () => drop());

describe("performance index", () => {
  it("PI = views at 72h / median of the previous 20 posts on the same platform", async () => {
    const r = await pool.query<{ post_id: string; pi: string | null; baseline_views: string | null; baseline_n: string }>(
      "select post_id, pi, baseline_views, baseline_n from v_post_performance where workspace_id = $1 order by published_at", [ws],
    );
    const series = [5000, 4000, ...views];
    for (const [k, row] of r.rows.entries()) {
      const prev = series.slice(Math.max(0, k - 20), k);
      if (row.post_id.startsWith("pst_hist")) {
        expect(row.pi).toBeNull(); // backfilled posts never get their own PI
        continue;
      }
      if (prev.length < 3) {
        expect(row.pi).toBeNull();
        continue;
      }
      expect(Number(row.baseline_views)).toBeCloseTo(median(prev)!, 6);
      expect(Number(row.pi)).toBeCloseTo(series[k]! / median(prev)!, 6);
    }
  });

  it("goal index uses link clicks for a leads brand", async () => {
    const r = await pool.query<{ goal_value: string; goal_index: string | null }>(
      "select goal_value, goal_index from v_post_performance where post_id = 'pst_29'",
    );
    expect(Number(r.rows[0]!.goal_value)).toBe(Math.round(views[29]! / 100));
    expect(r.rows[0]!.goal_index).not.toBeNull();
  });

  it("rolling 10-post median, 25th percentile and hit rate", async () => {
    const r = await pool.query<{ median_views: string; p25_views: string; n: string }>(
      "select median_views, p25_views, n from v_rolling_by_post where post_id = 'pst_29'",
    );
    const last10 = views.slice(-10);
    expect(Number(r.rows[0]!.median_views)).toBeCloseTo(median(last10)!, 6);
    expect(Number(r.rows[0]!.p25_views)).toBeCloseTo(percentile(last10, 0.25)!, 6);
    expect(Number(r.rows[0]!.n)).toBe(10);
    const weekly = await pool.query("select count(*)::int as n from v_rolling_weekly where workspace_id = $1", [ws]);
    expect(weekly.rows[0].n).toBeGreaterThan(5);
  });
});

describe("learning model view", () => {
  it("learns that price reveals beat the baseline and logo intros do not", async () => {
    const est = await loadEstimates(pool, ws, "instagram");
    const pr = est.byKey.get("hook_type=price_reveal")!;
    const logo = est.byKey.get("hook_type=logo_intro")!;
    expect(pr.n).toBeGreaterThan(5);
    expect(pr.mu_hat).toBeGreaterThan(0.3);
    expect(logo.mu_hat).toBeLessThan(-0.2);
    // Shrinkage: |mu_hat| is smaller than the raw mean.
    const raw = await pool.query<{ mean_log_pi: string; n: string }>(
      "select mean_log_pi, n from v_feature_stats where workspace_id = $1 and feature = 'hook_type' and value = 'price_reveal'", [ws],
    );
    const n = Number(raw.rows[0]!.n);
    expect(pr.mu_hat).toBeCloseTo((n * Number(raw.rows[0]!.mean_log_pi)) / (n + 5), 6);
  });

  it("an idea combining a winning hook with the ever-present format is proven", async () => {
    const est = await loadEstimates(pool, ws, "instagram");
    const { combine, probBeatsBaseline } = await import("../../src/learning/model.js");
    const win = combine({ hook_type: "price_reveal", format: "reel" }, est);
    const lose = combine({ hook_type: "logo_intro", format: "reel" }, est);
    expect(probBeatsBaseline(win.mu, win.se)).toBeGreaterThan(0.7);
    expect(probBeatsBaseline(lose.mu, lose.se)).toBeLessThan(0.3);
  });

  it("priors enter through feature_priors", async () => {
    await pool.query(
      `insert into feature_priors (workspace_id, platform, feature, value, mu_prior, source)
       values ($1, 'instagram', 'hook_type', 'myth_bust', 0.4, 'competitor_winners')`, [ws],
    );
    const est = await loadEstimates(pool, ws, "instagram");
    expect(est.byKey.get("hook_type=myth_bust")).toMatchObject({ n: 0, mu_hat: 0.4 });
  });

  it("post counts drive the cold-start switch", async () => {
    const r = await pool.query("select posts_with_pi::int as n from v_platform_post_counts where workspace_id = $1 and platform = 'instagram'", [ws]);
    expect(r.rows[0].n).toBe(30 - 1); // the first tracked post has only 2 prior posts
  });
});

describe("floor protection", () => {
  it("persists the explore share from weekly medians", async () => {
    const d = await updateFloorProtection(pool, ws, "instagram");
    const r = await pool.query("select explore_share::float8 as s from explore_state where workspace_id = $1", [ws]);
    expect(d.explore_share).toBe(r.rows[0]?.s ?? 0.2);
  });
});
