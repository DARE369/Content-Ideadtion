-- Brand research: what the company sells (and which lines earn the money),
-- its public profiles, and researched competitor suggestions.
set search_path = ideation, public, extensions;

alter table brand_brains
  add column if not exists description text,
  add column if not exists industry text,
  add column if not exists country text,
  add column if not exists social_links jsonb not null default '[]'::jsonb,
  add column if not exists competitor_suggestions jsonb not null default '[]'::jsonb,
  add column if not exists research jsonb;

-- Row Level Security on every ideation table. The app connects as the tables'
-- owner, which RLS does not restrict; this only closes access through
-- Supabase's public API keys.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'ideation' loop
    execute format('alter table ideation.%I enable row level security', t.tablename);
  end loop;
end $$;
