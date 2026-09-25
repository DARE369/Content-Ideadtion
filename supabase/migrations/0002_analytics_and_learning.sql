-- Analytics (performance index, baselines, rolling stats) and the learning model.
-- All numbers are computed here or in code; Claude only interprets them.

set search_path = ideation, public;

-- Historic posts pulled when an account connects have no 72 h snapshot, only a
-- lifetime count. They are stored with offset_label = 'backfill'. Lifetime views
-- are >= 72 h views, so using them in the baseline is conservative (it makes PI
-- harder, not easier, to beat) and it disappears as real 72 h snapshots arrive.

-- One row per published post with the 72 h metrics the index is built on.
create view v_post_metrics_72h as
select
  p.id                 as post_id,
  p.workspace_id,
  p.platform,
  p.published_at,
  p.features,
  p.idea_id,
  p.brief_id,
  bb.goal,
  coalesce(s72.views, sbf.views)                                  as views,
  case when s72.views is not null then '72h'
       when sbf.views is not null then 'backfill' end            as views_basis,
  s72.link_clicks,
  s72.profile_visits,
  s72.followers_gained,
  case when num_nonnulls(s72.likes, s72.comments, s72.shares, s72.saves, s72.sends) > 0
       then coalesce(s72.likes, 0) + coalesce(s72.comments, 0) + coalesce(s72.shares, 0)
          + coalesce(s72.saves, 0) + coalesce(s72.sends, 0) end  as engagements,
  -- The goal metric: link clicks for leads/sales, follows (or profile visits) for reach.
  case bb.goal
    when 'leads' then s72.link_clicks
    when 'sales' then s72.link_clicks
    when 'reach' then coalesce(s72.followers_gained, s72.profile_visits)
    when 'engagement' then
      case when num_nonnulls(s72.likes, s72.comments, s72.shares, s72.saves, s72.sends) > 0
           then coalesce(s72.likes, 0) + coalesce(s72.comments, 0) + coalesce(s72.shares, 0)
              + coalesce(s72.saves, 0) + coalesce(s72.sends, 0) end
  end                                                             as goal_value
from published_posts p
join brand_brains bb on bb.workspace_id = p.workspace_id
left join metric_snapshots s72 on s72.published_post_id = p.id and s72.offset_label = '72h'
left join metric_snapshots sbf on sbf.published_post_id = p.id and sbf.offset_label = 'backfill';

-- PI = views at 72 h / median(views at 72 h, same platform, previous 20 posts).
-- A baseline needs at least 3 earlier posts; before that PI stays null (cold start).
create view v_post_performance as
select
  m.*,
  b.baseline_views,
  b.baseline_n,
  case when b.baseline_n >= 3 and b.baseline_views > 0 and m.views_basis = '72h'
       then m.views / b.baseline_views end                        as pi,
  g.baseline_goal,
  case when g.baseline_n >= 3 and g.baseline_goal > 0 and m.goal_value is not null
       then m.goal_value / g.baseline_goal end                    as goal_index
from v_post_metrics_72h m
left join lateral (
  select percentile_cont(0.5) within group (order by prev.views)::numeric as baseline_views,
         count(*) as baseline_n
  from (
    select q.views from v_post_metrics_72h q
    where q.workspace_id = m.workspace_id and q.platform = m.platform
      and q.published_at < m.published_at and q.views is not null
    order by q.published_at desc limit 20
  ) prev
) b on true
left join lateral (
  select percentile_cont(0.5) within group (order by prev.goal_value)::numeric as baseline_goal,
         count(*) as baseline_n
  from (
    select q.goal_value from v_post_metrics_72h q
    where q.workspace_id = m.workspace_id and q.platform = m.platform
      and q.published_at < m.published_at and q.goal_value is not null
    order by q.published_at desc limit 20
  ) prev
) g on true;

-- Pre-aggregated copy for sub-second page loads; refreshed after each ingestion pass.
create materialized view mv_post_performance as select * from v_post_performance;
create unique index mv_post_performance_pk on mv_post_performance (post_id);
create index mv_post_performance_ws on mv_post_performance (workspace_id, platform, published_at desc);

-- Rolling 10-post median, 25th percentile and hit rate as of each post.
create view v_rolling_by_post as
select
  p.post_id, p.workspace_id, p.platform, p.published_at,
  r.median_views, r.p25_views, r.hit_rate, r.n
from mv_post_performance p
cross join lateral (
  select percentile_cont(0.5)  within group (order by x.views)::numeric as median_views,
         percentile_cont(0.25) within group (order by x.views)::numeric as p25_views,
         avg(case when x.pi > 1 then 1.0 when x.pi is not null then 0.0 end) as hit_rate,
         count(*) as n
  from (
    select q.views, q.pi from mv_post_performance q
    where q.workspace_id = p.workspace_id and q.platform = p.platform
      and q.published_at <= p.published_at and q.views is not null
    order by q.published_at desc limit 10
  ) x
) r
where p.views is not null;

-- The overview chart: the rolling values as they stood at the end of each week.
create view v_rolling_weekly as
select distinct on (workspace_id, platform, week)
  workspace_id, platform, date_trunc('week', published_at) as week,
  median_views, p25_views, hit_rate, n
from (select *, date_trunc('week', published_at) as week from v_rolling_by_post) t
order by workspace_id, platform, week, published_at desc;

-- ---------------------------------------------------------------------------
-- Learning model: shrunk estimate of log(PI) per brand x platform x feature value
--   mu_hat = (n * mean + k * mu_prior) / (n + k),  k = 5
-- The posterior standard error uses the brand's pooled variance of log(PI)
-- (default 0.49, i.e. sd 0.7, until there are 5 posts). Probability of beating
-- the baseline, P(log PI > 0) = Phi(mu / se), is computed in code, where an
-- idea's mu = intercept + sum of (mu_hat - intercept) over its feature values.
-- ---------------------------------------------------------------------------

create view v_feature_stats as
select
  m.workspace_id, m.platform, f.key as feature, f.value #>> '{}' as value,
  count(*)                 as n,
  avg(ln(m.pi))::numeric   as mean_log_pi
from v_post_performance m
cross join lateral jsonb_each(m.features) f
where m.pi > 0 and jsonb_typeof(f.value) in ('string', 'number', 'boolean')
group by 1, 2, 3, 4;

create view v_pooled_variance as
select workspace_id, platform,
       count(*) as n_posts,
       avg(ln(pi))::numeric as mean_log_pi,   -- the intercept: the brand's typical log(PI)
       case when count(*) >= 5 then greatest(var_samp(ln(pi)), 0.05) else 0.49 end::numeric as sigma2
from v_post_performance
where pi > 0
group by 1, 2;

create view v_feature_estimates as
with k as (select 5::numeric as k)
select
  coalesce(s.workspace_id, pr.workspace_id) as workspace_id,
  coalesce(s.platform, pr.platform)         as platform,
  coalesce(s.feature, pr.feature)           as feature,
  coalesce(s.value, pr.value)               as value,
  coalesce(s.n, 0)                          as n,
  s.mean_log_pi,
  coalesce(pr.mu_prior, 0)                  as mu_prior,
  (coalesce(s.n, 0) * coalesce(s.mean_log_pi, 0) + k.k * coalesce(pr.mu_prior, 0))
    / (coalesce(s.n, 0) + k.k)              as mu_hat,
  sqrt(coalesce(v.sigma2, 0.49) / (coalesce(s.n, 0) + k.k)) as se
from v_feature_stats s
full outer join feature_priors pr
  on pr.workspace_id = s.workspace_id and pr.platform = s.platform
 and pr.feature = s.feature and pr.value = s.value
cross join k
left join v_pooled_variance v
  on v.workspace_id = coalesce(s.workspace_id, pr.workspace_id)
 and v.platform = coalesce(s.platform, pr.platform);

-- Count of posts with results per platform, used for the cold-start switch (L -> P).
create view v_platform_post_counts as
select workspace_id, platform, count(*) filter (where pi is not null) as posts_with_pi
from v_post_performance
group by 1, 2;
