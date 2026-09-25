import type { Db } from "../db.js";

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/**
 * Enqueue a job. With a dedupe key, a second enqueue while one is pending is a
 * no-op; with `once`, the key can never run twice (e.g. "nightly:2026-09-25").
 */
export async function enqueue(
  db: Db,
  kind: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number; once?: boolean } = {},
): Promise<void> {
  await db.query(
    `insert into jobs (kind, payload, run_at, dedupe_key, max_attempts)
     select $1, $2, coalesce($3, now()), $4, $5
     where not ($6 and exists (select 1 from jobs where dedupe_key = $4))
     on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing`,
    [kind, JSON.stringify(payload), opts.runAt ?? null, opts.dedupeKey ?? null, opts.maxAttempts ?? 5, opts.once ?? false],
  );
}

/** Claim ready jobs; SKIP LOCKED lets several workers share the table safely. */
export async function claim(db: Db, limit = 5): Promise<Job[]> {
  const res = await db.query<Job>(
    `update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
     where id in (
       select id from jobs where status = 'queued' and run_at <= now()
       order by run_at limit $1 for update skip locked
     )
     returning id, kind, payload, attempts, max_attempts`,
    [limit],
  );
  return res.rows;
}

export async function complete(db: Db, id: number): Promise<void> {
  await db.query("update jobs set status = 'done', updated_at = now() where id = $1", [id]);
}

/** Retry with exponential backoff until max_attempts, then mark failed. */
export async function fail(db: Db, job: Job, err: unknown, retryInMs?: number): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const final = job.attempts >= job.max_attempts;
  const delayMs = retryInMs ?? Math.min(3_600_000, 2 ** job.attempts * 30_000);
  await db.query(
    `update jobs set status = $2, last_error = $3, run_at = now() + make_interval(secs => $4), updated_at = now()
     where id = $1`,
    [job.id, final ? "failed" : "queued", msg.slice(0, 2000), delayMs / 1000],
  );
}
