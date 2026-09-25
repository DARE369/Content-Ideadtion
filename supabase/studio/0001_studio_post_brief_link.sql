-- Day-1 migration for the STUDIO's own schema (not applied by `npm run migrate`).
-- Adds the one thing the loop needs: every published post carries the idea and
-- brief it came from. Replace `public.published_posts` with the studio's actual
-- published-post table, then run it with the studio's migrations.

alter table public.published_posts
  add column if not exists brief_id text,
  add column if not exists idea_id  text;

create index if not exists published_posts_brief_id on public.published_posts (brief_id);

-- At publish time the studio sets both columns from the brief it rendered
-- (brief.payload->>'brief_id' and brief.payload->>'idea_id'), then calls
-- POST /v1/published-posts on the ideation service (the stage-3 contract).
