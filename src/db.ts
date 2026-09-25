import pg from "pg";
import { config } from "./config.js";

let pool: pg.Pool | undefined;

export type Db = Pick<pg.Pool, "query">;

export function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: config().DATABASE_URL,
    max: 10,
    // Every connection works inside the ideation schema.
    options: "-c search_path=ideation,public",
  });
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
