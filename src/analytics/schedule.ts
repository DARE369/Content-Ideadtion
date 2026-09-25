import type { Db } from "../db.js";
import { SNAPSHOT_OFFSETS, type SnapshotOffset } from "../types.js";

/** Snapshots at 1 h, 6 h, 24 h, 72 h, 7 d and 28 d after publishing. */
export const OFFSET_MS: Record<SnapshotOffset, number> = {
  "1h": 3_600_000,
  "6h": 6 * 3_600_000,
  "24h": 24 * 3_600_000,
  "72h": 72 * 3_600_000,
  "7d": 7 * 86_400_000,
  "28d": 28 * 86_400_000,
};

/** A missed offset is still taken if we are within this window of it; otherwise its label would lie. */
export const LATE_TOLERANCE_MS = 0.25;

export type PlannedSnapshot = { offset: SnapshotOffset | "backfill"; dueAt: Date };

/**
 * Which snapshots to schedule for a post. Future offsets are scheduled as-is.
 * A past offset is only taken if we are still close to it (within 25% of its
 * offset), so a "72h" row always means roughly 72 hours. A post registered after
 * its 72 h window gets one 'backfill' snapshot instead: it counts towards the
 * baseline but never gets a PI of its own.
 */
export function snapshotPlan(publishedAt: Date, now = new Date()): PlannedSnapshot[] {
  const out: PlannedSnapshot[] = [];
  let missed72h = false;
  for (const offset of SNAPSHOT_OFFSETS) {
    const dueAt = new Date(publishedAt.getTime() + OFFSET_MS[offset]);
    const lateBy = now.getTime() - dueAt.getTime();
    if (lateBy <= 0) out.push({ offset, dueAt });
    else if (lateBy <= OFFSET_MS[offset] * LATE_TOLERANCE_MS) out.push({ offset, dueAt: now });
    else if (offset === "72h") missed72h = true;
  }
  if (missed72h && !out.some((p) => p.offset === "72h")) out.push({ offset: "backfill", dueAt: now });
  return out;
}

export async function scheduleSnapshots(db: Db, postId: string, publishedAt: Date, now = new Date()): Promise<void> {
  for (const p of snapshotPlan(publishedAt, now)) {
    await db.query(
      `insert into snapshot_jobs (published_post_id, offset_label, due_at) values ($1, $2, $3)
       on conflict do nothing`,
      [postId, p.offset, p.dueAt],
    );
  }
}
