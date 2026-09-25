import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { AUTOPSY_ROLE, AutopsyOutput, REPORT_ROLE, WeeklyReportOutput } from "../ai/prompts/reports.js";
import { brandBrainBlock } from "../ai/prompts/shared.js";
import { newId } from "../lib/ids.js";
import { loadBrain } from "../ideation/context.js";
import { updateFloorProtection } from "../learning/floor.js";
import { FEATURE_KEYS, isPlatform } from "../types.js";
import { keepCited, weeklyTables, type ReportPost, type RollingPoint } from "./tables.js";

export const MIN_POSTS_FOR_REPORT = 3;
const RULE_TTL_DAYS = 14;

async function lookbackPosts(db: Db, workspaceId: string, since: Date): Promise<ReportPost[]> {
  const r = await db.query(
    `select m.post_id, m.platform, m.published_at::text, m.views::float8 as views, m.pi::float8 as pi,
            m.goal_index::float8 as goal_index, s.comments::float8 as comments, i.label, m.features
     from mv_post_performance m
     left join ideas i on i.id = m.idea_id
     left join metric_snapshots s on s.published_post_id = m.post_id and s.offset_label = '72h'
     where m.workspace_id = $1 and m.published_at >= $2 and m.views_basis = '72h'
     order by m.published_at`,
    [workspaceId, since],
  );
  return r.rows as ReportPost[];
}

/** Weekly "what worked / what didn't / why / what next" report. Returns null in cold start. */
export async function weeklyReport(db: Db, workspaceId: string, end = new Date()): Promise<string | null> {
  const brain = await loadBrain(db, workspaceId);
  if (!brain) return null;
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const lookback = await lookbackPosts(db, workspaceId, new Date(end.getTime() - 28 * 86_400_000));
  if (lookback.length < MIN_POSTS_FOR_REPORT) return null;

  // Floor protection runs first so the report can explain any change.
  const explore: Record<string, { share: number; reason: string | null }> = {};
  for (const p of new Set(lookback.map((x) => x.platform))) {
    if (!isPlatform(p)) continue;
    const d = await updateFloorProtection(db, workspaceId, p);
    explore[p] = { share: d.explore_share, reason: d.reason };
  }
  const rolling = (await db.query(
    `select platform, week::text, median_views::float8 as median_views, p25_views::float8 as p25_views, hit_rate::float8 as hit_rate
     from v_rolling_weekly where workspace_id = $1 and week >= $2 order by week`,
    [workspaceId, new Date(end.getTime() - 35 * 86_400_000)],
  )).rows as RollingPoint[];

  const tables = weeklyTables({ start, end }, lookback, rolling, explore);
  const out = await structured({
    db, task: "report:weekly", workspaceId, tier: "strategy",
    system: [REPORT_ROLE, brandBrainBlock(brain)],
    content: `Report tables (JSON):\n${JSON.stringify(tables)}`,
    schema: WeeklyReportOutput,
  });

  const known = new Set(lookback.map((p) => p.post_id));
  const nextRules = keepCited(out.what_next, known).filter(
    (r) => (FEATURE_KEYS as readonly string[]).includes(r.feature) && (isPlatform(r.platform) || r.platform === "all"),
  );
  const body = {
    headline: out.headline,
    what_worked: keepCited(out.what_worked, known),
    what_didnt: keepCited(out.what_didnt, known),
    why: keepCited(out.why, known),
    what_next: nextRules,
    nudges: out.nudges,
  };
  const id = newId("rpt");
  await db.query(
    `insert into reports (id, workspace_id, kind, period_start, period_end, input_table, body) values ($1,$2,'weekly',$3,$4,$5,$6)`,
    [id, workspaceId, start, end, JSON.stringify(tables), JSON.stringify(body)],
  );
  // "What next" becomes structured rules the ideation engine reads; older weekly rules expire.
  await db.query(
    `update guidance_rules set active_until = now()
     where workspace_id = $1 and source_report_id is not null and (active_until is null or active_until > now())`,
    [workspaceId],
  );
  for (const r of nextRules) {
    await db.query(
      `insert into guidance_rules (id, workspace_id, platform, feature, value, action, share, rationale, source_report_id, active_until)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(days => $10))`,
      [newId("rul"), workspaceId, r.platform === "all" ? null : r.platform, r.feature, r.value, r.action, r.share, r.rationale, id, RULE_TTL_DAYS],
    );
  }
  return id;
}

/** Short autopsy 72 h after a post. Skipped while the platform has no baseline yet. */
export async function postAutopsy(db: Db, postId: string): Promise<string | null> {
  const p = (await db.query(
    `select m.post_id, m.workspace_id, m.platform, m.published_at::text, m.pi::float8 as pi, m.goal_index::float8 as goal_index,
            m.baseline_views::float8 as baseline_views, m.views::float8 as views, m.features, pp.caption
     from v_post_performance m join published_posts pp on pp.id = m.post_id where m.post_id = $1`,
    [postId],
  )).rows[0];
  if (!p || p.pi == null) return null;
  const brain = await loadBrain(db, p.workspace_id);
  if (!brain) return null;
  const curve = (await db.query(
    `select offset_label, views, likes, comments, shares, saves, sends, avg_watch_seconds, completion_rate, link_clicks
     from metric_snapshots where published_post_id = $1 order by captured_at`, [postId],
  )).rows;
  const similar = (await db.query(
    `select post_id, pi::float8 as pi, features from v_post_performance
     where workspace_id = $1 and platform = $2 and post_id <> $3 and pi is not null
       and features->>'hook_type' is not distinct from $4
     order by published_at desc limit 5`,
    [p.workspace_id, p.platform, postId, p.features?.hook_type ?? null],
  )).rows;
  const input = { post: p, metric_curve: curve, similar_posts_same_hook: similar };
  const out = await structured({
    db, task: "report:autopsy", workspaceId: p.workspace_id, tier: "fast",
    system: [AUTOPSY_ROLE, brandBrainBlock(brain)],
    content: `Input (JSON):\n${JSON.stringify(input)}`,
    schema: AutopsyOutput,
    maxTokens: 1500,
  });
  const known = new Set([postId, ...similar.map((s: { post_id: string }) => s.post_id)]);
  const body = { ...out, cited_post_ids: out.cited_post_ids.filter((id) => known.has(id)) };
  const id = newId("rpt");
  await db.query(
    `insert into reports (id, workspace_id, kind, published_post_id, input_table, body) values ($1,$2,'autopsy',$3,$4,$5)
     on conflict (published_post_id) where kind = 'autopsy' do nothing`,
    [id, p.workspace_id, postId, JSON.stringify(input), JSON.stringify(body)],
  );
  return id;
}
