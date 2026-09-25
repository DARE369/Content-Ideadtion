import type { Db } from "../db.js";

/** Read models for the analytics page. All served from pre-aggregated views. */

export async function overview(db: Db, workspaceId: string, weeks = 12) {
  const [rolling, headline, bestWorst, goal] = await Promise.all([
    db.query(
      `select platform, week, median_views::float8 as median_views, p25_views::float8 as p25_views, hit_rate::float8 as hit_rate, n
       from v_rolling_weekly where workspace_id = $1 and week >= date_trunc('week', now()) - make_interval(weeks => $2)
       order by platform, week`,
      [workspaceId, weeks],
    ),
    // Headline numbers: the three success metrics, now vs. a month ago.
    db.query(
      `with latest as (
         select distinct on (platform) platform, median_views, p25_views, hit_rate from v_rolling_by_post
         where workspace_id = $1 order by platform, published_at desc),
       month_ago as (
         select distinct on (platform) platform, median_views, p25_views, hit_rate from v_rolling_by_post
         where workspace_id = $1 and published_at < now() - interval '28 days' order by platform, published_at desc)
       select l.platform, l.median_views::float8 as median_now, m.median_views::float8 as median_month_ago,
              l.p25_views::float8 as p25_now, m.p25_views::float8 as p25_month_ago,
              l.hit_rate::float8 as hit_rate_now, m.hit_rate::float8 as hit_rate_month_ago
       from latest l left join month_ago m using (platform) order by l.platform`,
      [workspaceId],
    ),
    db.query(
      `(select 'best' as kind, post_id, platform, published_at, pi::float8 as pi, views::float8 as views from mv_post_performance
        where workspace_id = $1 and pi is not null and published_at > now() - interval '28 days' order by pi desc limit 3)
       union all
       (select 'worst', post_id, platform, published_at, pi::float8, views::float8 from mv_post_performance
        where workspace_id = $1 and pi is not null and published_at > now() - interval '28 days' order by pi asc limit 3)`,
      [workspaceId],
    ),
    db.query(
      `select platform, date_trunc('week', published_at) as week, avg(goal_index)::float8 as goal_index, count(*) as n
       from mv_post_performance where workspace_id = $1 and goal_index is not null
         and published_at >= date_trunc('week', now()) - make_interval(weeks => $2)
       group by 1, 2 order by 1, 2`,
      [workspaceId, weeks],
    ),
  ]);
  return { headline: headline.rows, rolling: rolling.rows, best_worst: bestWorst.rows, goal_trend: goal.rows };
}

export async function postDetail(db: Db, postId: string) {
  const [post, curve, autopsy] = await Promise.all([
    db.query(
      `select p.id, p.platform, p.platform_post_id, p.permalink, p.caption, p.published_at, p.features, p.link_status,
              p.match_confidence::float8 as match_confidence, m.pi::float8 as pi, m.goal_index::float8 as goal_index,
              m.baseline_views::float8 as baseline_views, m.views::float8 as views_72h,
              i.id as idea_id, i.title as idea_title, i.label, i.score_components, b.id as brief_id, b.payload as brief
       from published_posts p
       left join mv_post_performance m on m.post_id = p.id
       left join ideas i on i.id = p.idea_id
       left join briefs b on b.id = p.brief_id
       where p.id = $1`,
      [postId],
    ),
    db.query(
      `select offset_label, captured_at, views, reach, likes, comments, shares, saves, sends, avg_watch_seconds,
              completion_rate, link_clicks, profile_visits, followers_gained
       from metric_snapshots where published_post_id = $1 order by captured_at`,
      [postId],
    ),
    db.query("select body, created_at from reports where published_post_id = $1 and kind = 'autopsy'", [postId]),
  ]);
  if (!post.rows[0]) return null;
  return { ...post.rows[0], metric_curve: curve.rows, autopsy: autopsy.rows[0] ?? null };
}

export async function latestReport(db: Db, workspaceId: string) {
  const r = await db.query(
    `select id, period_start, period_end, body, created_at from reports
     where workspace_id = $1 and kind = 'weekly' order by created_at desc limit 1`,
    [workspaceId],
  );
  return r.rows[0] ?? null;
}
