import type { Db } from "../db.js";

/**
 * "Never re-fetch": provider responses are cached by request key. Posts,
 * thumbnails and API responses are read from here before any network call.
 */
export async function cached<T>(
  db: Db,
  provider: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await db.query<{ body: T }>(
    "select body from provider_cache where key = $1 and expires_at > now()",
    [key],
  );
  if (hit.rows[0]) return hit.rows[0].body;
  const body = await load();
  await db.query(
    `insert into provider_cache (key, provider, body, expires_at)
     values ($1, $2, $3, now() + make_interval(secs => $4))
     on conflict (key) do update set body = excluded.body, fetched_at = now(), expires_at = excluded.expires_at`,
    [key, provider, JSON.stringify(body), ttlSeconds],
  );
  return body;
}
