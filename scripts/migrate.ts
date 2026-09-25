import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/** Applies supabase/migrations/*.sql in order, once each, inside transactions. */
export async function migrate(connectionString: string, dir = "supabase/migrations"): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("create schema if not exists ideation");
    await client.query("create table if not exists ideation._migrations (name text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await client.query<{ name: string }>("select name from ideation._migrations")).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await client.query("begin");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("insert into ideation._migrations (name) values ($1)", [file]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`${file}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  migrate(url).then((a) => console.log(a.length ? `applied: ${a.join(", ")}` : "up to date"), (err) => {
    console.error(err.message);
    process.exit(1);
  });
}
