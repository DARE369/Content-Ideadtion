import { config } from "../config.js";
import type { Db } from "../db.js";
import { StudioTokenResolver } from "../providers/tokens.js";
import type { TokenResolver } from "../providers/types.js";
import { handlers, RetryLater } from "./handlers.js";
import { claim, complete, enqueue, fail } from "./queue.js";

/** Shared by the long-running worker and the serverless cron route. */

export function tokenResolver(): TokenResolver {
  const { STUDIO_TOKEN_URL, STUDIO_API_TOKEN } = config();
  if (STUDIO_TOKEN_URL && STUDIO_API_TOKEN) return new StudioTokenResolver(STUDIO_TOKEN_URL, STUDIO_API_TOKEN);
  return { accessToken: async () => { throw new Error("STUDIO_TOKEN_URL / STUDIO_API_TOKEN are not configured"); } };
}

/** Enqueue whatever recurring work is due (UTC). Safe to call as often as you like. */
export async function tickSchedule(db: Db, now = new Date()): Promise<void> {
  const d = now.toISOString().slice(0, 10);
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  await enqueue(db, "run_due_snapshots", {}, { dedupeKey: `snap:${d}:${Math.floor(m / 10)}`, once: true });
  if (m >= 130) await enqueue(db, "nightly", {}, { dedupeKey: `nightly:${d}`, once: true });
  if (m >= 200) await enqueue(db, "account_metrics", {}, { dedupeKey: `acct:${d}`, once: true });
  if (now.getUTCDay() === 0 && m >= 18 * 60 + 5) await enqueue(db, "weekly_reports", {}, { dedupeKey: `weekly:${d}`, once: true });
}

export async function drainOnce(db: Db, tokens: TokenResolver, batch = 5): Promise<number> {
  const jobs = await claim(db, batch);
  await Promise.all(jobs.map(async (job) => {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`unknown job kind ${job.kind}`);
      await handler(db, job, tokens);
      await complete(db, job.id);
    } catch (err) {
      if (err instanceof RetryLater) {
        await db.query("update jobs set status = 'queued', attempts = attempts - 1, run_at = now() + make_interval(secs => $2) where id = $1", [job.id, err.delayMs / 1000]);
        return;
      }
      console.error(`[job ${job.id} ${job.kind}]`, err instanceof Error ? err.message : err);
      await fail(db, job, err);
    }
  }));
  return jobs.length;
}

/**
 * Serverless: drain jobs until the queue is empty or the time budget is spent.
 * A job that outlives its function is marked running; `requeueStuck` recovers it.
 */
export async function drainFor(db: Db, tokens: TokenResolver, budgetMs: number): Promise<number> {
  const until = Date.now() + budgetMs;
  let total = 0;
  while (Date.now() < until) {
    const n = await drainOnce(db, tokens, 2);
    if (n === 0) break;
    total += n;
  }
  return total;
}

/** Jobs left 'running' by a killed function go back to the queue after 15 minutes. */
export async function requeueStuck(db: Db): Promise<void> {
  await db.query(
    `update jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
       last_error = coalesce(last_error, 'timed out'), updated_at = now()
     where status = 'running' and updated_at < now() - interval '15 minutes'`,
  );
}
