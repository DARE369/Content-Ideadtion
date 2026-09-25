import { config } from "../config.js";
import { closeDb, db } from "../db.js";
import { StudioTokenResolver } from "../providers/tokens.js";
import type { TokenResolver } from "../providers/types.js";
import { handlers, RetryLater } from "./handlers.js";
import { claim, complete, enqueue, fail } from "./queue.js";

/**
 * The worker drains the jobs table. Recurring jobs are enqueued either by pg_cron
 * (supabase/optional/pg_cron_schedule.sql) or by the built-in scheduler below.
 */

export function tokenResolver(): TokenResolver {
  const { STUDIO_TOKEN_URL, STUDIO_API_TOKEN } = config();
  if (STUDIO_TOKEN_URL && STUDIO_API_TOKEN) return new StudioTokenResolver(STUDIO_TOKEN_URL, STUDIO_API_TOKEN);
  return { accessToken: async () => { throw new Error("STUDIO_TOKEN_URL / STUDIO_API_TOKEN are not configured"); } };
}

/** Minimal built-in schedule (UTC) for deployments without pg_cron. */
export async function tickSchedule(now = new Date()): Promise<void> {
  const d = now.toISOString().slice(0, 10);
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  const pool = db();
  await enqueue(pool, "run_due_snapshots", {}, { dedupeKey: `snap:${d}:${Math.floor(m / 10)}`, once: true });
  if (m >= 130) await enqueue(pool, "nightly", {}, { dedupeKey: `nightly:${d}`, once: true });
  if (m >= 200) await enqueue(pool, "account_metrics", {}, { dedupeKey: `acct:${d}`, once: true });
  if (now.getUTCDay() === 0 && m >= 18 * 60 + 5) await enqueue(pool, "weekly_reports", {}, { dedupeKey: `weekly:${d}`, once: true });
}

export async function drainOnce(tokens: TokenResolver, batch = 5): Promise<number> {
  const pool = db();
  const jobs = await claim(pool, batch);
  await Promise.all(jobs.map(async (job) => {
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`unknown job kind ${job.kind}`);
      await handler(pool, job, tokens);
      await complete(pool, job.id);
    } catch (err) {
      if (err instanceof RetryLater) {
        await pool.query("update jobs set status = 'queued', attempts = attempts - 1, run_at = now() + make_interval(secs => $2) where id = $1", [job.id, err.delayMs / 1000]);
        return;
      }
      console.error(`[job ${job.id} ${job.kind}]`, err instanceof Error ? err.message : err);
      await fail(pool, job, err);
    }
  }));
  return jobs.length;
}

async function main(): Promise<void> {
  const tokens = tokenResolver();
  const builtInSchedule = process.env.WORKER_SCHEDULE !== "pg_cron";
  let stopping = false;
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  console.log(`[worker] started (schedule: ${builtInSchedule ? "built-in" : "pg_cron"})`);
  let lastTick = 0;
  while (!stopping) {
    if (builtInSchedule && Date.now() - lastTick > 60_000) {
      await tickSchedule().catch((err) => console.error("[schedule]", err));
      lastTick = Date.now();
    }
    const n = await drainOnce(tokens).catch((err) => {
      console.error("[worker]", err);
      return 0;
    });
    if (n === 0) await new Promise((r) => setTimeout(r, 2_000));
  }
  await closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
