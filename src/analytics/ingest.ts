import type { Db } from "../db.js";
import { PublishedPost } from "../contracts/stage3.js";
import { newId } from "../lib/ids.js";
import { RateLimitedError } from "../lib/http.js";
import { suggestMatch } from "../matching/external.js";
import { ownProvider } from "../providers/registry.js";
import type { AccountRef, OwnPost, TokenResolver } from "../providers/types.js";
import type { Features, Platform } from "../types.js";
import { enqueue } from "../jobs/queue.js";
import { publishFeatures } from "./features.js";
import { scheduleSnapshots } from "./schedule.js";

const MAX_SNAPSHOT_ATTEMPTS = 6;

async function accountFor(db: Db, workspaceId: string, platform: string, accountId?: string | null): Promise<AccountRef | null> {
  const res = await db.query<AccountRef>(
    `select id, platform, external_account_id, handle, account_kind, studio_connection_id
     from connected_accounts
     where workspace_id = $1 and platform = $2 and disconnected_at is null and ($3::text is null or id = $3)
     order by connected_at limit 1`,
    [workspaceId, platform, accountId ?? null],
  );
  return res.rows[0] ?? null;
}

/**
 * Stage-3 intake: the studio (or the reserved scheduler) reports a published post.
 * Features are frozen now so later edits to the idea do not rewrite history.
 */
export async function registerPublishedPost(db: Db, input: unknown): Promise<{ id: string; link_status: string }> {
  const post = PublishedPost.parse(input);
  const publishedAt = new Date(post.published_at);
  const ctx = await db.query<{ timezone: string }>("select timezone from brand_brains where workspace_id = $1", [post.workspace_id]);
  const timeZone = ctx.rows[0]?.timezone ?? "UTC";

  let briefId = post.brief_id;
  let ideaId = post.idea_id;
  let linkStatus = "linked";
  let confidence: number | null = null;
  if (!briefId) {
    const m = await suggestMatch(db, post.workspace_id, post.platform, publishedAt, post.caption ?? null);
    if (m) {
      // Suggested only: the user confirms before it counts. Features stay empty until then.
      linkStatus = "suggested";
      confidence = m.score;
      briefId = m.brief_id;
      ideaId = m.idea_id;
    } else {
      linkStatus = "unmatched";
    }
  }

  let features: Features = publishFeatures(null, null, publishedAt, post.duration_seconds, timeZone);
  if (briefId && linkStatus === "linked") features = await featuresFromBrief(db, briefId, publishedAt, post.duration_seconds, timeZone);

  const id = newId("pst");
  const res = await db.query<{ id: string; link_status: string }>(
    `insert into published_posts (id, workspace_id, connected_account_id, platform, platform_post_id, asset_id,
        brief_id, idea_id, published_at, permalink, caption, duration_seconds, features, link_status, match_confidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     on conflict (platform, platform_post_id) do update set
       -- A studio report with a brief beats an earlier backfilled/unmatched copy of the same post.
       brief_id = case when excluded.link_status = 'linked' then excluded.brief_id else published_posts.brief_id end,
       idea_id = case when excluded.link_status = 'linked' then excluded.idea_id else published_posts.idea_id end,
       features = case when excluded.link_status = 'linked' then excluded.features else published_posts.features end,
       link_status = case when excluded.link_status = 'linked' then 'linked' else published_posts.link_status end,
       permalink = coalesce(excluded.permalink, published_posts.permalink)
     returning id, link_status`,
    [id, post.workspace_id, post.connected_account_id ?? null, post.platform, post.platform_post_id, post.asset_id ?? null,
      briefId, ideaId, publishedAt, post.permalink ?? null, post.caption ?? null, post.duration_seconds ?? null,
      JSON.stringify(features), linkStatus, confidence],
  );
  const row = res.rows[0]!;
  await scheduleSnapshots(db, row.id, publishedAt);
  if (ideaId && linkStatus === "linked") await db.query("update ideas set status = 'briefed' where id = $1", [ideaId]);
  return row;
}

async function featuresFromBrief(db: Db, briefId: string, publishedAt: Date, duration: number | null | undefined, timeZone: string): Promise<Features> {
  const r = await db.query<{ features: Features; payload: { format?: string; cta?: { type?: string }; language?: string } }>(
    `select i.features, b.payload from briefs b join ideas i on i.id = b.idea_id where b.id = $1`,
    [briefId],
  );
  const row = r.rows[0];
  if (!row) return publishFeatures(null, null, publishedAt, duration, timeZone);
  return publishFeatures(
    row.features,
    { format: row.payload.format, cta_type: row.payload.cta?.type, language: row.payload.language },
    publishedAt, duration, timeZone,
  );
}

/** The user confirms (or rejects) a suggested match for an externally published post. */
export async function confirmMatch(db: Db, postId: string, accept: boolean): Promise<void> {
  if (!accept) {
    await db.query(
      `update published_posts set link_status = 'unmatched', brief_id = null, idea_id = null, match_confidence = null
       where id = $1 and link_status = 'suggested'`, [postId],
    );
    return;
  }
  const r = await db.query<{ brief_id: string; published_at: Date; duration_seconds: number | null; workspace_id: string }>(
    `select brief_id, published_at, duration_seconds, workspace_id from published_posts where id = $1 and link_status = 'suggested'`, [postId],
  );
  const p = r.rows[0];
  if (!p) return;
  const tz = await db.query<{ timezone: string }>("select timezone from brand_brains where workspace_id = $1", [p.workspace_id]);
  const features = await featuresFromBrief(db, p.brief_id, p.published_at, p.duration_seconds, tz.rows[0]?.timezone ?? "UTC");
  await db.query(`update published_posts set link_status = 'confirmed', features = $2 where id = $1`, [postId, JSON.stringify(features)]);
}

interface DueSnapshot {
  published_post_id: string;
  offset_label: string;
  attempts: number;
  workspace_id: string;
  platform: Platform;
  connected_account_id: string | null;
  platform_post_id: string;
  published_at: Date;
  permalink: string | null;
  caption: string | null;
  duration_seconds: number | null;
}

/**
 * Take due snapshots. Rate-limited snapshots are deferred (not_before), never
 * dropped; other failures retry up to MAX_SNAPSHOT_ATTEMPTS.
 */
export async function runDueSnapshots(db: Db, tokens: TokenResolver, limit = 50): Promise<{ done: number; deferred: number; failed: number }> {
  const due = await db.query<DueSnapshot>(
    `select j.published_post_id, j.offset_label, j.attempts, p.workspace_id, p.platform, p.connected_account_id,
            p.platform_post_id, p.published_at, p.permalink, p.caption, p.duration_seconds
     from snapshot_jobs j join published_posts p on p.id = j.published_post_id
     where j.status = 'pending' and j.due_at <= now() and (j.not_before is null or j.not_before <= now())
     order by j.due_at limit $1`,
    [limit],
  );
  const stats = { done: 0, deferred: 0, failed: 0 };
  for (const s of due.rows) {
    try {
      const account = await accountFor(db, s.workspace_id, s.platform, s.connected_account_id);
      if (!account) throw new Error(`no connected ${s.platform} account`);
      const token = await tokens.accessToken(account);
      const post: OwnPost = {
        platform_post_id: s.platform_post_id, published_at: s.published_at.toISOString(), permalink: s.permalink,
        caption: s.caption, media_type: null, duration_seconds: s.duration_seconds,
      };
      const { metrics, raw } = await ownProvider(s.platform).fetchPostMetrics(account, token, post);
      await db.query(
        `insert into metric_snapshots (published_post_id, offset_label, views, reach, likes, comments, shares, saves, sends,
            avg_watch_seconds, completion_rate, link_clicks, profile_visits, followers_gained, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (published_post_id, offset_label) do update set captured_at = now(),
           views = excluded.views, reach = excluded.reach, likes = excluded.likes, comments = excluded.comments,
           shares = excluded.shares, saves = excluded.saves, sends = excluded.sends,
           avg_watch_seconds = excluded.avg_watch_seconds, completion_rate = excluded.completion_rate,
           link_clicks = excluded.link_clicks, profile_visits = excluded.profile_visits,
           followers_gained = excluded.followers_gained, raw = excluded.raw`,
        [s.published_post_id, s.offset_label, metrics.views, metrics.reach, metrics.likes, metrics.comments, metrics.shares,
          metrics.saves, metrics.sends, metrics.avg_watch_seconds, metrics.completion_rate, metrics.link_clicks,
          metrics.profile_visits, metrics.followers_gained, JSON.stringify(raw ?? null)],
      );
      await db.query(
        `update snapshot_jobs set status = 'done', attempts = attempts + 1, last_error = null
         where published_post_id = $1 and offset_label = $2`,
        [s.published_post_id, s.offset_label],
      );
      stats.done++;
      if (s.offset_label === "72h") {
        await enqueue(db, "autopsy", { post_id: s.published_post_id }, { dedupeKey: `autopsy:${s.published_post_id}` });
      }
    } catch (err) {
      if (err instanceof RateLimitedError) {
        await db.query(
          `update snapshot_jobs set not_before = now() + make_interval(secs => $3), last_error = $4
           where published_post_id = $1 and offset_label = $2`,
          [s.published_post_id, s.offset_label, Math.ceil(err.retryAfterMs / 1000), err.message],
        );
        stats.deferred++;
      } else {
        const failed = s.attempts + 1 >= MAX_SNAPSHOT_ATTEMPTS;
        await db.query(
          `update snapshot_jobs set attempts = attempts + 1, status = $3, last_error = $4,
             not_before = now() + make_interval(secs => $5)
           where published_post_id = $1 and offset_label = $2`,
          [s.published_post_id, s.offset_label, failed ? "failed" : "pending", String(err instanceof Error ? err.message : err).slice(0, 2000),
            2 ** s.attempts * 300],
        );
        if (failed) stats.failed++;
        else stats.deferred++;
      }
    }
  }
  if (stats.done > 0) await enqueue(db, "refresh_performance", {}, { dedupeKey: "refresh_performance" });
  return stats;
}

/** When an account connects, pull its recent history so baselines exist from day one. */
export async function backfillAccount(db: Db, tokens: TokenResolver, account: AccountRef & { workspace_id: string }, limit = 30): Promise<number> {
  const token = await tokens.accessToken(account);
  const posts = await ownProvider(account.platform).listRecentPosts(account, token, limit);
  for (const p of posts) {
    await registerPublishedPost(db, {
      platform_post_id: p.platform_post_id,
      platform: account.platform,
      workspace_id: account.workspace_id,
      connected_account_id: account.id,
      brief_id: null,
      idea_id: null,
      published_at: new Date(p.published_at).toISOString(),
      permalink: p.permalink,
      caption: p.caption,
      duration_seconds: p.duration_seconds,
    });
  }
  return posts.length;
}

/** Daily account-level metrics (followers, profile visits). */
export async function ingestAccountMetrics(db: Db, tokens: TokenResolver): Promise<number> {
  const accounts = await db.query<AccountRef>(
    `select id, platform, external_account_id, handle, account_kind, studio_connection_id
     from connected_accounts where disconnected_at is null`,
  );
  let n = 0;
  for (const a of accounts.rows) {
    try {
      const m = await ownProvider(a.platform).fetchAccountMetrics(a, await tokens.accessToken(a));
      await db.query(
        `insert into account_metrics_daily (connected_account_id, day, followers, profile_visits, raw)
         values ($1, current_date, $2, $3, $4)
         on conflict (connected_account_id, day) do update set followers = excluded.followers,
           profile_visits = excluded.profile_visits, raw = excluded.raw`,
        [a.id, m.followers, m.profile_visits, JSON.stringify(m.raw ?? null)],
      );
      n++;
    } catch (err) {
      console.warn(`[account_metrics] ${a.platform} ${a.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return n;
}

export async function refreshPerformance(db: Db): Promise<void> {
  await db.query("refresh materialized view concurrently mv_post_performance");
}
