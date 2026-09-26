import type pg from "pg";
import { MIGRATIONS } from "./migrations.generated.js";

/**
 * Brings the ideation schema up to date on first use, so deployments never need
 * SQL pasted by hand. Safe to call concurrently (advisory lock) and repeatedly.
 * Databases set up by running the SQL files manually are recognised and
 * baselined rather than re-created.
 */

let ready: Promise<void> | null = null;

export function ensureSchema(pool: pg.Pool): Promise<void> {
  ready ??= migrate(pool).catch((err) => {
    ready = null; // try again on the next request
    throw err;
  });
  return ready;
}

async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext('ideation_migrations'))");
    await client.query("create schema if not exists ideation");
    await client.query("create table if not exists ideation._migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await client.query<{ name: string }>("select name from ideation._migrations")).rows.map((r) => r.name));

    // Tables created by hand in the SQL editor: record what's already there.
    if (done.size === 0) {
      const exists = async (sql: string) => ((await client.query(sql)).rowCount ?? 0) > 0;
      if (await exists("select 1 from pg_tables where schemaname = 'ideation' and tablename = 'workspaces'")) {
        await client.query("insert into ideation._migrations (name) values ('0001_ideation_schema.sql') on conflict do nothing");
        done.add("0001_ideation_schema.sql");
      }
      if (await exists("select 1 from pg_views where schemaname = 'ideation' and viewname = 'v_post_performance'")) {
        await client.query("insert into ideation._migrations (name) values ('0002_analytics_and_learning.sql') on conflict do nothing");
        done.add("0002_analytics_and_learning.sql");
      }
    }

    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      await client.query("begin");
      try {
        await client.query(m.sql);
        await client.query("insert into ideation._migrations (name) values ($1)", [m.name]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Database migration ${m.name} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('ideation_migrations'))").catch(() => {});
    client.release();
  }
}

/** Test hook. */
export function resetSchemaState(): void {
  ready = null;
}
