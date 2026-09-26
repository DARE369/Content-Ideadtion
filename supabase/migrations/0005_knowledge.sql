-- Week 2: business knowledge (every owned site, stored once), uploads, products,
-- growth plan, campaigns, and brief optimisation caches.
set search_path = ideation, public, extensions;

create extension if not exists pg_trgm with schema extensions;

-- Sites the business owns. Related domains are added automatically when they
-- are clearly the same brand, otherwise they wait for the user to confirm.
create table if not exists sources (
  id               text primary key,                        -- src_...
  workspace_id     text not null references workspaces(id) on delete cascade,
  domain           text not null,
  url              text not null,
  role             text not null default 'primary' check (role in ('primary', 'product_site', 'shop', 'sister_brand', 'link_in_bio', 'other')),
  added_by         text not null default 'user' check (added_by in ('user', 'auto', 'confirmed')),
  status           text not null default 'active' check (status in ('active', 'pending_confirm', 'rejected')),
  relation_score   integer,
  relation_reasons text[] not null default '{}',
  boilerplate      text[] not null default '{}',            -- menu/footer lines stripped before any AI
  last_scanned_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (workspace_id, domain)
);

create table if not exists scan_runs (
  id              text primary key,                         -- scn_...
  workspace_id    text not null references workspaces(id) on delete cascade,
  status          text not null default 'preview' check (status in ('preview', 'extracting', 'done', 'failed', 'cancelled')),
  counts          jsonb not null default '{}'::jsonb,       -- pages by type, reused, unreadable...
  est_tokens      integer not null default 0,
  est_cost_usd    numeric(10, 4) not null default 0,
  actual_cost_usd numeric(10, 4),
  batch_id        text,
  page_ids        text[] not null default '{}',
  batch_groups    jsonb not null default '{}'::jsonb,       -- custom_id -> page ids
  pages_total     integer not null default 0,
  pages_done      integer not null default 0,
  cards_added     integer not null default 0,
  error           text,
  checked_at      timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists scan_runs_ws on scan_runs (workspace_id, created_at desc);

-- One row per page ever fetched. Re-checks are conditional; AI extraction only
-- runs when the cleaned text changed (content_hash <> extracted_hash).
create table if not exists page_snapshots (
  id               text primary key,                        -- pag_...
  workspace_id     text not null references workspaces(id) on delete cascade,
  source_id        text references sources(id) on delete cascade,
  url              text not null,
  page_type        text not null,
  priority         integer not null default 0,              -- 3 high, 2 medium, 1 low, 0 skip
  status           text not null default 'fetched' check (status in ('queued', 'fetched', 'unreadable', 'blocked', 'failed', 'skipped')),
  selected         boolean not null default true,
  title            text,
  etag             text,
  last_modified    text,
  sitemap_lastmod  timestamptz,
  content_hash     text,
  text             text,
  tokens_est       integer not null default 0,
  structured       jsonb,                                   -- JSON-LD facts (read without AI)
  fetched_at       timestamptz,
  checked_at       timestamptz,
  extracted_hash   text,
  extracted_at     timestamptz,
  prompt_version   text,
  unique (workspace_id, url)
);

-- Extraction results keyed by content hash + prompt version, shared across
-- workspaces: the same page text is never sent to the model twice.
create table if not exists extractions (
  key         text primary key,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

create table if not exists products (
  id              text primary key,                         -- prd_...
  workspace_id    text not null references workspaces(id) on delete cascade,
  name            text not null,
  kind            text not null default 'product' check (kind in ('product', 'service')),
  revenue_role    text check (revenue_role in ('core', 'secondary', 'lead_magnet')),
  status          text not null default 'active' check (status in ('active', 'launching', 'seasonal', 'retired')),
  origin          text not null default 'user' check (origin in ('user', 'brand_brain', 'scan', 'upload')),
  confirmed       boolean not null default true,
  summary         text,
  ai_summary      text,
  summary_hash    text,
  audience        text,
  price_text      text,
  url             text,
  source_domain   text,
  benefits        text[] not null default '{}',
  image_upload_ids text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists products_ws_name on products (workspace_id, lower(name));

create table if not exists uploads (
  id            text primary key,                           -- upl_...
  workspace_id  text not null references workspaces(id) on delete cascade,
  sha256        text not null,
  filename      text not null,
  mime          text not null,
  size_bytes    bigint not null default 0,
  storage_path  text,                                       -- null when storage isn't configured
  status        text not null default 'pending' check (status in ('pending', 'uploaded', 'processed', 'failed')),
  pages         integer,
  cards_added   integer not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  unique (workspace_id, sha256)
);

create table if not exists knowledge_cards (
  id            text primary key,                           -- kc_...
  workspace_id  text not null references workspaces(id) on delete cascade,
  type          text not null check (type in ('product', 'service', 'feature', 'pricing', 'proof', 'case_study', 'testimonial',
                  'client', 'faq', 'objection', 'claim', 'disclaimer', 'audience', 'differentiator', 'process', 'event', 'news',
                  'location', 'person', 'note')),
  title         text not null,
  body          text not null default '',
  attributes    jsonb not null default '{}'::jsonb,
  product_ids   text[] not null default '{}',
  sources       jsonb not null default '[]'::jsonb,         -- [{kind, ref, url, quote}]
  status        text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected', 'stale')),
  confidence    text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  created_by    text not null default 'ai' check (created_by in ('ai', 'user')),
  embedding     vector(384),
  used_count    integer not null default 0,
  first_seen    timestamptz not null default now(),
  last_verified timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists knowledge_cards_ws on knowledge_cards (workspace_id, status, type);
create index if not exists knowledge_cards_trgm on knowledge_cards using gin ((title || ' ' || body) gin_trgm_ops);

create table if not exists objectives (
  id              text primary key,                         -- obj_...
  workspace_id    text not null references workspaces(id) on delete cascade,
  title           text not null,
  period_start    date,
  period_end      date,
  segment         text,
  product_ids     text[] not null default '{}',
  motion          text[] not null default '{}',
  stage_messages  jsonb not null default '{}'::jsonb,
  success_metric  text,
  target_value    numeric,
  current_value   numeric,
  weight          numeric not null default 1,
  status          text not null default 'active' check (status in ('active', 'done', 'paused')),
  created_at      timestamptz not null default now()
);

create table if not exists campaigns (
  id                 text primary key,                      -- cmp_... is taken by competitors; campaigns use cpg_
  workspace_id       text not null references workspaces(id) on delete cascade,
  objective_id       text references objectives(id) on delete set null,
  name               text not null,
  goal               text not null default 'leads' check (goal in ('awareness', 'leads', 'sales', 'launch', 'event', 'retention')),
  product_ids        text[] not null default '{}',
  audience           text,
  key_message        text,
  offer              text,
  cta_text           text,
  cta_url            text,
  start_date         date,
  end_date           date,
  platforms          text[] not null default '{}',
  posts_per_week     integer not null default 3,
  phases             jsonb not null default '[]'::jsonb,
  success_metric     text,
  target_value       numeric,
  current_value      numeric,
  knowledge_card_ids text[] not null default '{}',
  status             text not null default 'draft' check (status in ('draft', 'active', 'done')),
  created_at         timestamptz not null default now()
);

-- Ideas carry the chain objective -> campaign -> product -> buyer stage.
alter table ideas
  add column if not exists campaign_id text references campaigns(id) on delete set null,
  add column if not exists objective_id text references objectives(id) on delete set null,
  add column if not exists product_id text references products(id) on delete set null,
  add column if not exists campaign_phase text,
  add column if not exists planned_for date,
  add column if not exists grounded boolean not null default false;
alter table ideas drop constraint if exists ideas_mode_check;
alter table ideas add constraint ideas_mode_check check (mode in ('autopilot', 'give_me_ideas', 'refine', 'campaign'));
create index if not exists ideas_campaign on ideas (campaign_id) where campaign_id is not null;

-- Free YouTube keyword checks (search.list costs 100 of 10,000 daily units): cached 7 days.
create table if not exists youtube_keyword_cache (
  keyword     text not null,
  region      text not null default '',
  results     jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (keyword, region)
);

-- Nightly ideation skips idle workspaces (see precompute): track the last visit.
alter table workspaces add column if not exists last_seen_at timestamptz;

-- Existing Brand Brain offers become product records.
insert into products (id, workspace_id, name, revenue_role, price_text, url, summary, origin, confirmed)
select 'prd_' || substr(md5(b.workspace_id || lower(o->>'name')), 1, 24), b.workspace_id, o->>'name',
       case when o->>'revenue_role' in ('core', 'secondary', 'lead_magnet') then o->>'revenue_role' end,
       o->>'price', o->>'url', o->>'description', 'brand_brain', true
from brand_brains b, jsonb_array_elements(b.offers) o
where coalesce(o->>'name', '') <> ''
on conflict do nothing;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'ideation' loop
    execute format('alter table ideation.%I enable row level security', t.tablename);
  end loop;
end $$;
