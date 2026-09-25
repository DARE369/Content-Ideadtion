import pg from "pg";
import { config } from "./config.js";

let pool: pg.Pool | undefined;

const SEARCH_PATH = "ideation,public,extensions";

export type Db = Pick<pg.Pool, "query">;

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config().DATABASE_URL,
      max: config().DB_POOL_MAX,
      // Every connection works inside the ideation schema. Supabase installs
      // pgvector in `extensions`, so that schema is on the path too.
      options: `-c search_path=${SEARCH_PATH}`,
    });
    // Poolers may drop startup options; set it again per connection (needs a session-mode pooler).
    pool.on("connect", (client) => void client.query(`set search_path to ${SEARCH_PATH}`).catch(() => {}));
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
