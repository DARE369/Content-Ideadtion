-- Optional: on Supabase, let pg_cron enqueue the recurring jobs instead of an
-- external scheduler. The worker (`npm run worker`) still executes them.
-- Requires the pg_cron extension (Database > Extensions in Supabase).

create extension if not exists pg_cron;

-- Nightly: refresh signals, rescore opportunities, pre-generate Idea Cards (02:10 UTC)
select cron.schedule('ideation-nightly', '10 2 * * *',
  $$insert into ideation.jobs (kind, dedupe_key)
    select 'nightly', k from (select 'nightly:' || current_date as k) x
    where not exists (select 1 from ideation.jobs j where j.dedupe_key = x.k)$$);

-- Every 10 minutes: run due metric snapshots
select cron.schedule('ideation-snapshots', '*/10 * * * *',
  $$insert into ideation.jobs (kind, dedupe_key)
    select 'run_due_snapshots', k from (select 'snap:' || date_trunc('minute', now()) as k) x
    where not exists (select 1 from ideation.jobs j where j.dedupe_key = x.k)$$);

-- Daily: account-level metrics (03:20 UTC)
select cron.schedule('ideation-account-metrics', '20 3 * * *',
  $$insert into ideation.jobs (kind, dedupe_key)
    select 'account_metrics', k from (select 'acct:' || current_date as k) x
    where not exists (select 1 from ideation.jobs j where j.dedupe_key = x.k)$$);

-- Weekly report, Sunday 18:05 UTC, so it is ready before Monday
select cron.schedule('ideation-weekly-report', '5 18 * * 0',
  $$insert into ideation.jobs (kind, dedupe_key)
    select 'weekly_reports', k from (select 'weekly:' || current_date as k) x
    where not exists (select 1 from ideation.jobs j where j.dedupe_key = x.k)$$);
