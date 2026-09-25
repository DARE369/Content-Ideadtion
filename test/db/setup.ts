import pg from "pg";
import { migrate } from "../../scripts/migrate.js";
import { resetConfig } from "../../src/config.js";
import { closeDb, db } from "../../src/db.js";

/**
 * Creates a throwaway database from TEST_DATABASE_URL (any database on a server
 * with pgvector), runs the migrations and points the app at it.
 */
export async function freshDb(): Promise<{ pool: pg.Pool; drop: () => Promise<void> }> {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) throw new Error("TEST_DATABASE_URL is not set");
  const name = `cie_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`create database ${name}`);
  await c.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  resetConfig();
  await migrate(process.env.DATABASE_URL);
  const pool = db();
  return {
    pool,
    drop: async () => {
      await closeDb();
      const c2 = new pg.Client({ connectionString: admin });
      await c2.connect();
      await c2.query(`drop database if exists ${name} with (force)`);
      await c2.end();
    },
  };
}

export async function seedWorkspace(pool: pg.Pool, opts: { ws?: string; goal?: string } = {}) {
  const ws = opts.ws ?? "wsp_test";
  await pool.query("insert into workspaces (id, studio_workspace_id, name) values ($1, $1, 'Test Bakery')", [ws]);
  await pool.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, timezone, trends_geo, tone_words, pillars, audience, offers, banned_topics, confirmed_at, brand_kit)
     values ($1, 'https://bakery.example', $2, 'en-NG', 'Africa/Lagos', 'NG', '{warm,expert}', '{pricing,decorating,behind the scenes}',
             'Home bakers in Lagos', '[{"name":"Pricing sheet","url":"https://bakery.example/sheet"}]', '{politics}', now(), '{"colors":["#F4A7B9"]}')`,
    [ws, opts.goal ?? "leads"],
  );
  for (const p of ["instagram", "tiktok"]) {
    await pool.query(
      `insert into connected_accounts (id, workspace_id, platform, external_account_id, account_kind, studio_connection_id)
       values ($1, $2, $3, $4, 'business', $5)`,
      [`acc_${p}`, ws, p, `ext_${p}`, `conn_${p}`],
    );
  }
  return ws;
}

/** Insert a post with a 72 h snapshot directly (bypassing providers). */
export async function seedPost(
  pool: pg.Pool, ws: string, id: string, platform: string, publishedAt: Date, views: number | null,
  features: Record<string, string> = {}, extra: { link_clicks?: number; basis?: "72h" | "backfill" } = {},
) {
  await pool.query(
    `insert into published_posts (id, workspace_id, connected_account_id, platform, platform_post_id, published_at, features)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, ws, `acc_${platform}`, platform, `ext_${id}`, publishedAt, JSON.stringify(features)],
  );
  if (views != null) {
    await pool.query(
      `insert into metric_snapshots (published_post_id, offset_label, views, likes, comments, link_clicks) values ($1,$2,$3,$4,$5,$6)`,
      [id, extra.basis ?? "72h", views, Math.round(views / 20), 3, extra.link_clicks ?? null],
    );
  }
}
