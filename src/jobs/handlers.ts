import { scanMarket } from "../research/market.js";
import type { Db } from "../db.js";
import { pollBatch } from "../ai/batch.js";
import { backfillAccount, ingestAccountMetrics, refreshPerformance, runDueSnapshots } from "../analytics/ingest.js";
import { ingestCompetitorComments, ingestCompetitors } from "../competitors/ingest.js";
import { tagCompetitorPosts, visionTagsHandler } from "../competitors/vision.js";
import { deliverBrief } from "../handoff/briefs.js";
import { precomputeWorkspace, rescoreWorkspace } from "../ideation/precompute.js";
import { purgeExpired } from "../privacy/deletion.js";
import type { AccountRef, TokenResolver } from "../providers/types.js";
import { postAutopsy, weeklyReport } from "../reports/weekly.js";
import { ingestGlobalSignals, ingestWorkspaceSignals } from "../signals/ingest.js";
import { stalePlaybooks } from "../playbooks/index.js";
import { enqueue, type Job } from "./queue.js";

export class RetryLater extends Error {
  constructor(public readonly delayMs: number) {
    super(`retry in ${delayMs} ms`);
  }
}

type Handler = (db: Db, job: Job, tokens: TokenResolver) => Promise<void>;

const workspaces = async (db: Db) =>
  (await db.query<{ workspace_id: string; trends_geo: string | null }>(
    "select workspace_id, trends_geo from brand_brains where confirmed_at is not null",
  )).rows;

const str = (job: Job, key: string): string => {
  const v = job.payload[key];
  if (typeof v !== "string") throw new Error(`job ${job.kind} missing ${key}`);
  return v;
};

export const handlers: Record<string, Handler> = {
  /** Fan out the nightly work: global feeds once, then one job per workspace. */
  async nightly(db) {
    const ws = await workspaces(db);
    const geos = [...new Set(ws.map((w) => w.trends_geo).filter((g): g is string => !!g))];
    await ingestGlobalSignals(db, geos);
    for (const w of ws) await enqueue(db, "nightly_workspace", { workspace_id: w.workspace_id }, { dedupeKey: `nightly:${w.workspace_id}` });
    await purgeExpired(db);
    for (const s of stalePlaybooks()) console.warn(`[playbooks] ${s.platform} playbook is ${s.ageDays} days old; review it (limit 45)`);
  },

  async nightly_workspace(db, job, tokens) {
    const ws = str(job, "workspace_id");
    await ingestCompetitors(db, tokens, ws);
    await ingestCompetitorComments(db, ws);
    await ingestWorkspaceSignals(db, tokens, ws);
    await tagCompetitorPosts(db, ws).catch((err) => console.warn(`[vision] ${ws}: ${err instanceof Error ? err.message : err}`));
    await scanMarket(db, ws);
    await precomputeWorkspace(db, ws);
  },

  async run_due_snapshots(db, _job, tokens) {
    const s = await runDueSnapshots(db, tokens);
    if (s.done + s.deferred + s.failed > 0) console.log(`[snapshots] done=${s.done} deferred=${s.deferred} failed=${s.failed}`);
  },

  /** After new metrics: refresh the page tables, then rescore every shortlist (no Claude cost). */
  async refresh_performance(db) {
    await refreshPerformance(db);
    for (const w of await workspaces(db)) await rescoreWorkspace(db, w.workspace_id);
  },

  async account_metrics(db, _job, tokens) {
    await ingestAccountMetrics(db, tokens);
  },

  async backfill_account(db, job, tokens) {
    const a = (await db.query<AccountRef & { workspace_id: string }>(
      `select id, workspace_id, platform, external_account_id, handle, account_kind, studio_connection_id
       from connected_accounts where id = $1 and disconnected_at is null`, [str(job, "account_id")],
    )).rows[0];
    if (a) await backfillAccount(db, tokens, a);
  },

  async weekly_reports(db) {
    for (const w of await workspaces(db)) {
      await enqueue(db, "weekly_report", { workspace_id: w.workspace_id }, { dedupeKey: `weekly:${w.workspace_id}` });
    }
  },

  async weekly_report(db, job) {
    await weeklyReport(db, str(job, "workspace_id"));
  },

  async autopsy(db, job) {
    await refreshPerformance(db);
    await postAutopsy(db, str(job, "post_id"));
  },

  async batch_poll(db, job) {
    const done = await pollBatch(db, job.payload as Parameters<typeof pollBatch>[1], { vision_tags: visionTagsHandler });
    if (!done) throw new RetryLater(5 * 60_000);
  },

  async deliver_brief(db, job) {
    await deliverBrief(db, str(job, "brief_id"));
  },
};
