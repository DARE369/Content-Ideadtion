import pg from "pg";
import { config } from "./config.js";

let pool: pg.Pool | undefined;

const SEARCH_PATH = "ideation,public,extensions";

export type Db = Pick<pg.Pool, "query">;

/**
 * Hosted Postgres (Supabase, Neon, RDS...) expects TLS; local sockets and
 * localhost don't. `sslmode` in the URL, if present, wins.
 */
export function sslFor(url: string): pg.PoolConfig["ssl"] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const mode = u.searchParams.get("sslmode");
  if (mode) return mode === "disable" ? false : undefined;
  const host = u.searchParams.get("host") ?? u.hostname;
  if (!host || host.startsWith("/") || host === "localhost" || host === "127.0.0.1") return undefined;
  // Poolers present certificates that Node's default CA store may not chain; encrypt without pinning.
  return { rejectUnauthorized: false };
}

export function db(): pg.Pool {
  if (!pool) {
    const url = config().DATABASE_URL;
    pool = new pg.Pool({
      connectionString: url,
      ssl: sslFor(url),
      max: config().DB_POOL_MAX,
      idleTimeoutMillis: 10_000,
      // Every connection works inside the ideation schema. Supabase installs
      // pgvector in `extensions`, so that schema is on the path too.
      options: `-c search_path=${SEARCH_PATH}`,
    });
    // Poolers may drop startup options; set it again per connection (needs a session-mode pooler).
    pool.on("connect", (client) => void client.query(`set search_path to ${SEARCH_PATH}`).catch(() => {}));
    // Hosted poolers close idle connections; without a listener that error would crash the process.
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
  }
  return pool;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
