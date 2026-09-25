import type { Db } from "../db.js";

/**
 * Honour data deletion: when a user disconnects an account, their platform data
 * is removed. Cached platform data is purged on the retention schedule.
 */

export async function disconnectAccount(db: Db, accountId: string): Promise<{ posts: number; comments: number }> {
  const acct = await db.query<{ workspace_id: string; platform: string }>(
    "update connected_accounts set disconnected_at = now() where id = $1 returning workspace_id, platform", [accountId],
  );
  const a = acct.rows[0];
  if (!a) return { posts: 0, comments: 0 };
  // Posts from this account (snapshots cascade), their comments and daily account metrics.
  const comments = await db.query(
    `delete from audience_comments c using published_posts p
     where p.connected_account_id = $1 and c.origin = 'own' and c.platform = p.platform and c.platform_post_id = p.platform_post_id`,
    [accountId],
  );
  const posts = await db.query("delete from published_posts where connected_account_id = $1", [accountId]);
  await db.query("delete from account_metrics_daily where connected_account_id = $1", [accountId]);
  // If it was the only account on the platform, competitor data fetched through it goes too.
  const others = await db.query(
    "select 1 from connected_accounts where workspace_id = $1 and platform = $2 and disconnected_at is null", [a.workspace_id, a.platform],
  );
  if (!others.rowCount && a.platform === "instagram") {
    await db.query("delete from competitor_posts where workspace_id = $1 and platform = 'instagram'", [a.workspace_id]);
  }
  return { posts: posts.rowCount ?? 0, comments: comments.rowCount ?? 0 };
}

/** Full workspace deletion: everything cascades from the workspace row. */
export async function deleteWorkspace(db: Db, workspaceId: string): Promise<void> {
  await db.query("delete from workspaces where id = $1", [workspaceId]);
}

/**
 * Retention: expired provider cache, and competitor data older than the window
 * (refreshed nightly while in use, so only stale rows age out).
 */
export async function purgeExpired(db: Db, competitorRetentionDays = 90): Promise<void> {
  await db.query("delete from provider_cache where expires_at < now()");
  await db.query("delete from competitor_posts where fetched_at < now() - make_interval(days => $1)", [competitorRetentionDays]);
  await db.query("delete from audience_comments where origin = 'competitor' and fetched_at < now() - make_interval(days => $1)", [competitorRetentionDays]);
  await db.query("delete from jobs where status in ('done', 'failed') and updated_at < now() - interval '30 days'");
}
