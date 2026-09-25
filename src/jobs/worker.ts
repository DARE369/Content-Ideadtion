import { closeDb, db } from "../db.js";
import { drainOnce, requeueStuck, tickSchedule, tokenResolver } from "./runner.js";

/**
 * Long-running worker (any Node host). On Vercel the same work runs from the
 * /cron/tick route instead. Recurring jobs come from the built-in schedule or
 * pg_cron (supabase/optional/pg_cron_schedule.sql, WORKER_SCHEDULE=pg_cron).
 */
async function main(): Promise<void> {
  const tokens = tokenResolver();
  const pool = db();
  const builtInSchedule = process.env.WORKER_SCHEDULE !== "pg_cron";
  let stopping = false;
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  console.log(`[worker] started (schedule: ${builtInSchedule ? "built-in" : "pg_cron"})`);
  let lastTick = 0;
  while (!stopping) {
    if (Date.now() - lastTick > 60_000) {
      if (builtInSchedule) await tickSchedule(pool).catch((err) => console.error("[schedule]", err));
      await requeueStuck(pool).catch(() => {});
      lastTick = Date.now();
    }
    const n = await drainOnce(pool, tokens).catch((err) => {
      console.error("[worker]", err);
      return 0;
    });
    if (n === 0) await new Promise((r) => setTimeout(r, 2_000));
  }
  await closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
