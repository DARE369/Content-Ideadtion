import type { Db } from "../db.js";
import type { Platform } from "../types.js";

/**
 * Floor protection: if a platform's rolling median falls 2 weeks in a row,
 * exploring drops to 10% and the weekly report says why. It returns to 20%
 * after 2 recovering weeks.
 */

export const NORMAL_EXPLORE = 0.2;
export const PROTECT_EXPLORE = 0.1;

export interface FloorDecision {
  explore_share: number;
  reason: string | null;
}

/** `weeklyMedians` oldest first. */
export function floorDecision(weeklyMedians: number[], current: number): FloorDecision {
  const w = weeklyMedians.slice(-3);
  if (w.length < 3) return { explore_share: current, reason: null };
  const [a, b, c] = w as [number, number, number];
  if (b < a && c < b) {
    return { explore_share: PROTECT_EXPLORE, reason: `Rolling median fell two weeks running (${fmt(a)} → ${fmt(b)} → ${fmt(c)}); test share cut to 10% to protect the floor.` };
  }
  if (current < NORMAL_EXPLORE && b > a && c > b) {
    return { explore_share: NORMAL_EXPLORE, reason: `Rolling median recovered two weeks running (${fmt(a)} → ${fmt(b)} → ${fmt(c)}); test share back to 20%.` };
  }
  return { explore_share: current, reason: null };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export async function exploreShare(db: Db, workspaceId: string, platform: Platform): Promise<number> {
  const r = await db.query<{ explore_share: string }>(
    "select explore_share from explore_state where workspace_id = $1 and platform = $2", [workspaceId, platform],
  );
  return r.rows[0] ? Number(r.rows[0].explore_share) : NORMAL_EXPLORE;
}

export async function updateFloorProtection(db: Db, workspaceId: string, platform: Platform): Promise<FloorDecision> {
  const weeks = await db.query<{ median_views: string }>(
    `select median_views from v_rolling_weekly where workspace_id = $1 and platform = $2
     order by week desc limit 3`, [workspaceId, platform],
  );
  const medians = weeks.rows.map((r) => Number(r.median_views)).reverse();
  const current = await exploreShare(db, workspaceId, platform);
  const d = floorDecision(medians, current);
  if (d.explore_share !== current) {
    await db.query(
      `insert into explore_state (workspace_id, platform, explore_share, reason, updated_at) values ($1,$2,$3,$4, now())
       on conflict (workspace_id, platform) do update set explore_share = excluded.explore_share, reason = excluded.reason, updated_at = now()`,
      [workspaceId, platform, d.explore_share, d.reason],
    );
  }
  return d;
}
