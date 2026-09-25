-- Content Ideation Engine: core schema.
-- Lives in its own `ideation` schema inside the studio's Supabase Postgres so it
-- never collides with studio tables and can be dropped cleanly.

-- Supabase keeps extensions in their own schema; this also works on plain Postgres.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create schema if not exists ideation;
set search_path = ideation, public, extensions;

-- ---------------------------------------------------------------------------
-- Workspaces and the Brand Brain
-- ---------------------------------------------------------------------------

create table workspaces (
  id                   text primary key,                -- wsp_...
  studio_workspace_id  text not null unique,
  name                 text not null,
  created_at           timestamptz not null default now()
);

create table brand_brains (
  workspace_id   text primary key references workspaces(id) on delete cascade,
  website_url    text,
  brand_kit      jsonb not null default '{}'::jsonb,     -- colors, fonts, logo refs
  goal           text not null check (goal in ('reach', 'engagement', 'leads', 'sales')),
  language       text not null,                          -- BCP 47, e.g. en-NG
  timezone       text not null default 'UTC',            -- IANA; posting-time features use it
  trends_geo     text,                                   -- ISO country for Trends RSS / YouTube charts, e.g. NG
  tone_words     text[] not null default '{}',
  pillars        text[] not null default '{}',
  audience       text,
  offers         jsonb not null default '[]'::jsonb,     -- [{name, url, price?}]
  banned_topics  text[] not null default '{}',
  draft          jsonb,                                  -- Claude's draft before confirmation
  confirmed_at   timestamptz,
  updated_at     timestamptz not null default now()
);

-- Accounts the studio already connected. OAuth tokens stay in the studio; we
-- only keep the reference the studio's token resolver understands.
create table connected_accounts (
  id                     text primary key,               -- acc_...
  workspace_id           text not null references workspaces(id) on delete cascade,
  platform               text not null check (platform in ('tiktok', 'instagram', 'facebook', 'youtube', 'linkedin')),
  external_account_id    text not null,
  handle                 text,
  account_kind           text not null default 'personal' check (account_kind in ('personal', 'business', 'creator', 'page', 'organization', 'channel')),
  studio_connection_id   text not null,
  connected_at           timestamptz not null default now(),
  disconnected_at        timestamptz,
  unique (platform, external_account_id, workspace_id)
);

create table competitors (
  id            text primary key,                        -- cmp_...
  workspace_id  text not null references workspaces(id) on delete cascade,
  name          text not null,
  -- {instagram: "handle", youtube: "UC...", tiktok: "handle", linkedin: "...", facebook: "..."}
  handles       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- The spec caps competitors at 5 per workspace.
create function enforce_competitor_limit() returns trigger language plpgsql as $$
begin
  if (select count(*) from ideation.competitors where workspace_id = new.workspace_id) >= 5 then
    raise exception 'a workspace can track at most 5 competitors';
  end if;
  return new;
end $$;

create trigger competitors_limit before insert on competitors
  for each row execute function enforce_competitor_limit();

-- ---------------------------------------------------------------------------
-- Evidence: competitor posts, signals and audience comments
-- ---------------------------------------------------------------------------

create table competitor_posts (
  id               text primary key,                     -- cpp_...
  workspace_id     text not null references workspaces(id) on delete cascade,
  competitor_id    text not null references competitors(id) on delete cascade,
  platform         text not null,
  platform_post_id text not null,
  permalink        text,
  title            text,
  caption          text,
  thumbnail_url    text,
  media_type       text,
  published_at     timestamptz,
  views            bigint,
  likes            bigint,
  comments         bigint,
  outlier_ratio    numeric,                              -- vs. the account's last-30 median
  is_winner        boolean generated always as (outlier_ratio >= 2.5) stored,
  vision_tags      jsonb,                                -- hook/visual tags from Claude vision
  embedding        vector(384),
  source_url       text not null,                        -- legal: always keep source + fetch date
  fetched_at       timestamptz not null default now(),
  unique (competitor_id, platform, platform_post_id)
);
create index competitor_posts_winners on competitor_posts (workspace_id, platform) where outlier_ratio >= 2.5;

create table signals (
  id            text primary key,                        -- sig_...
  workspace_id  text references workspaces(id) on delete cascade,  -- null = global (e.g. Trends RSS)
  source        text not null check (source in (
                  'google_trends_rss', 'wikipedia_pageviews', 'youtube_most_popular',
                  'own_comments', 'competitor_comments', 'stackexchange', 'hackernews',
                  'tiktok_oembed', 'claude_web_search')),
  topic         text not null,
  title         text,
  url           text,
  geo           text,
  momentum      numeric,                                 -- 0..1, rising = high
  payload       jsonb not null default '{}'::jsonb,
  embedding     vector(384),
  observed_at   timestamptz not null default now(),
  observed_day  date not null default (now() at time zone 'utc')::date,
  fetched_at    timestamptz not null default now()
);
create index signals_ws_source on signals (workspace_id, source, observed_at desc);
create unique index signals_dedupe on signals (coalesce(workspace_id, ''), source, topic, coalesce(geo, ''), observed_day);

create table audience_comments (
  id                text primary key,                    -- cmt_...
  workspace_id      text not null references workspaces(id) on delete cascade,
  origin            text not null check (origin in ('own', 'competitor')),
  platform          text not null,
  platform_post_id  text not null,
  platform_comment_id text not null,
  text              text not null,
  like_count        integer,
  is_question       boolean not null default false,
  published_at      timestamptz,
  fetched_at        timestamptz not null default now(),
  unique (platform, platform_comment_id)
);
create index audience_comments_questions on audience_comments (workspace_id, published_at desc) where is_question;

-- ---------------------------------------------------------------------------
-- Ideas and briefs (stages 1 and 2)
-- ---------------------------------------------------------------------------

create table ideas (
  id               text primary key,                     -- ide_...
  workspace_id     text not null references workspaces(id) on delete cascade,
  run_id           text,                                 -- precompute run that produced it
  mode             text not null check (mode in ('autopilot', 'give_me_ideas', 'refine')),
  platform         text,                                 -- target platform the card was scored for; null = general
  title            text not null,
  why_now          text not null,
  core_idea        text not null,
  evidence         jsonb not null default '[]'::jsonb,   -- [{kind, id, url, summary}] own winners first
  -- learnable features: hook_type, format, pillar, length_bucket, idea_source, cta_type, visual_style, language
  features         jsonb not null default '{}'::jsonb,
  score            numeric,                              -- 0..100 opportunity score
  score_components jsonb,                                -- {L,F,P,M,W,G}
  relative_label   text,                                 -- top_third | middle_third | bottom_third
  confidence       text check (confidence in ('low', 'medium', 'high')),
  content_type     text,
  effort           text check (effort in ('low', 'medium', 'high')),
  risks            text[] not null default '{}',
  slot             text not null default 'explore' check (slot in ('exploit', 'explore')),
  label            text generated always as (case when slot = 'exploit' then 'proven' else 'test' end) stored,
  status           text not null default 'candidate' check (status in ('candidate', 'shortlisted', 'selected', 'briefed', 'dismissed')),
  embedding        vector(384),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz
);
create index ideas_shortlist on ideas (workspace_id, status, score desc);

-- The studio reads this table as a queue (status = 'queued'). Idempotent on id (= brief_id).
-- 'draft' briefs are pre-generated overnight for Autopilot and are invisible to the studio.
create table briefs (
  id            text primary key,                        -- brf_...
  idea_id       text not null references ideas(id) on delete cascade,
  workspace_id  text not null references workspaces(id) on delete cascade,
  kind          text not null check (kind in ('platform', 'general')),
  platform      text,
  payload       jsonb not null,                          -- brief.v1
  status        text not null default 'queued' check (status in ('draft', 'queued', 'delivered', 'acknowledged', 'failed')),
  attempts      integer not null default 0,
  last_error    text,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  check ((kind = 'platform') = (platform is not null))
);
create index briefs_queue on briefs (status, created_at) where status in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- Stage 3 (reserved) output contract, and analytics (stage 4)
-- ---------------------------------------------------------------------------

-- `published_post` from the reserved scheduling block. Analytics depends only on this.
create table published_posts (
  id                 text primary key,                   -- pst_...
  workspace_id       text not null references workspaces(id) on delete cascade,
  connected_account_id text references connected_accounts(id) on delete set null,
  platform           text not null,
  platform_post_id   text not null,
  asset_id           text,
  brief_id           text references briefs(id) on delete set null,
  idea_id            text references ideas(id) on delete set null,
  published_at       timestamptz not null,
  permalink          text,
  caption            text,
  duration_seconds   numeric,
  -- features frozen at publish time so learning is not affected by later edits to the idea
  features           jsonb not null default '{}'::jsonb,
  link_status        text not null default 'linked' check (link_status in ('linked', 'suggested', 'confirmed', 'unmatched')),
  match_confidence   numeric,
  created_at         timestamptz not null default now(),
  unique (platform, platform_post_id)
);
create index published_posts_ws_platform on published_posts (workspace_id, platform, published_at desc);

create table snapshot_jobs (
  published_post_id text not null references published_posts(id) on delete cascade,
  offset_label      text not null check (offset_label in ('1h', '6h', '24h', '72h', '7d', '28d', 'backfill')),
  due_at            timestamptz not null,
  status            text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts          integer not null default 0,
  not_before        timestamptz,                         -- deferred by rate limits, never dropped
  last_error        text,
  primary key (published_post_id, offset_label)
);
create index snapshot_jobs_due on snapshot_jobs (due_at) where status = 'pending';

-- Normalised metric model: nulls mean the platform does not provide the field. Never guessed.
create table metric_snapshots (
  published_post_id text not null references published_posts(id) on delete cascade,
  offset_label      text not null check (offset_label in ('1h', '6h', '24h', '72h', '7d', '28d', 'backfill')),
  captured_at       timestamptz not null default now(),
  views             bigint,
  reach             bigint,
  likes             bigint,
  comments          bigint,
  shares            bigint,
  saves             bigint,
  sends             bigint,
  avg_watch_seconds numeric,
  completion_rate   numeric,
  link_clicks       bigint,
  profile_visits    bigint,
  followers_gained  bigint,
  raw               jsonb,
  primary key (published_post_id, offset_label)
);

create table account_metrics_daily (
  connected_account_id text not null references connected_accounts(id) on delete cascade,
  day                  date not null,
  followers            bigint,
  profile_visits       bigint,
  raw                  jsonb,
  primary key (connected_account_id, day)
);

-- ---------------------------------------------------------------------------
-- Reports and the learning loop (stage 5)
-- ---------------------------------------------------------------------------

create table reports (
  id                text primary key,                    -- rpt_...
  workspace_id      text not null references workspaces(id) on delete cascade,
  kind              text not null check (kind in ('weekly', 'autopsy')),
  published_post_id text references published_posts(id) on delete cascade,
  period_start      timestamptz,
  period_end        timestamptz,
  input_table       jsonb not null,                      -- the numbers, computed in code
  body              jsonb not null,                      -- Claude's interpretation, with post citations
  created_at        timestamptz not null default now()
);
create unique index reports_autopsy_once on reports (published_post_id) where kind = 'autopsy';

-- "What next" items, as structured rules the ideation engine reads directly.
create table guidance_rules (
  id               text primary key,                     -- rul_...
  workspace_id     text not null references workspaces(id) on delete cascade,
  platform         text,
  feature          text not null,
  value            text not null,
  action           text not null check (action in ('prefer', 'avoid', 'test')),
  share            numeric,                              -- e.g. 2 of 3 reels -> 0.67
  rationale        text not null,
  source_report_id text references reports(id) on delete set null,
  active_from      timestamptz not null default now(),
  active_until     timestamptz
);

-- Priors for the shrinkage estimate (week 1: competitor winners; later: niche averages).
create table feature_priors (
  workspace_id  text not null references workspaces(id) on delete cascade,
  platform      text not null,
  feature       text not null,
  value         text not null,
  mu_prior      numeric not null,                        -- prior mean of log(PI)
  source        text not null,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, platform, feature, value)
);

create table explore_state (
  workspace_id  text not null references workspaces(id) on delete cascade,
  platform      text not null,
  explore_share numeric not null default 0.20,
  reason        text,
  updated_at    timestamptz not null default now(),
  primary key (workspace_id, platform)
);

-- ---------------------------------------------------------------------------
-- Operations: cost log, provider cache, job queue
-- ---------------------------------------------------------------------------

create table cost_log (
  id                 bigserial primary key,
  workspace_id       text references workspaces(id) on delete set null,
  task               text not null,
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  batch              boolean not null default false,
  cost_usd           numeric(12, 6) not null,
  latency_ms         integer,
  created_at         timestamptz not null default now()
);
create index cost_log_ws_day on cost_log (workspace_id, created_at);

-- "Never re-fetch": raw provider responses cached by request key.
create table provider_cache (
  key         text primary key,
  provider    text not null,
  body        jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Portable job queue (pgmq works too; this keeps local dev and tests dependency-free).
create table jobs (
  id           bigserial primary key,
  kind         text not null,
  payload      jsonb not null default '{}'::jsonb,
  run_at       timestamptz not null default now(),
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index jobs_ready on jobs (run_at) where status = 'queued';
create unique index jobs_dedupe on jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'running');
