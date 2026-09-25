import type { Db } from "../db.js";
import { newId } from "../lib/ids.js";
import { competitorProvider } from "../providers/registry.js";
import { youtubeComments } from "../providers/own/youtube.js";
import type { AccountRef, TokenResolver } from "../providers/types.js";
import { config } from "../config.js";
import { isPlatform, type Platform } from "../types.js";
import { outlierRatios } from "./outliers.js";
import { storeComments } from "../signals/ingest.js";

/**
 * Competitor ingestion (Instagram Business Discovery + YouTube Data API).
 * Facebook and LinkedIn have no free compliant route in week 1; TikTok links
 * pasted by the user go through oEmbed (captions only).
 */
export async function ingestCompetitors(db: Db, tokens: TokenResolver, workspaceId: string): Promise<{ posts: number; winners: number }> {
  const comps = await db.query<{ id: string; handles: Record<string, string> }>(
    "select id, handles from competitors where workspace_id = $1", [workspaceId],
  );
  const igAccount = await db.query<AccountRef>(
    `select id, platform, external_account_id, handle, account_kind, studio_connection_id from connected_accounts
     where workspace_id = $1 and platform = 'instagram' and disconnected_at is null and account_kind in ('business', 'creator')
     limit 1`, [workspaceId],
  );
  let posts = 0, winners = 0;
  for (const c of comps.rows) {
    for (const [platform, handle] of Object.entries(c.handles)) {
      if (!isPlatform(platform) || !handle) continue;
      const provider = competitorProvider(platform);
      if (!provider) continue;
      const via = platform === "instagram" ? igAccount.rows[0] : undefined;
      if (platform === "instagram" && !via) continue; // Business Discovery needs a connected professional account
      try {
        const records = await provider.recentPosts(handle, { viaAccount: via, token: via ? await tokens.accessToken(via) : undefined });
        for (const r of outlierRatios(records)) {
          await db.query(
            `insert into competitor_posts (id, workspace_id, competitor_id, platform, platform_post_id, permalink, title, caption,
                thumbnail_url, media_type, published_at, views, likes, comments, outlier_ratio, source_url)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             on conflict (competitor_id, platform, platform_post_id) do update set
               views = excluded.views, likes = excluded.likes, comments = excluded.comments,
               outlier_ratio = excluded.outlier_ratio, fetched_at = now()`,
            [newId("cpp"), workspaceId, c.id, platform, r.platform_post_id, r.permalink, r.title, r.caption, r.thumbnail_url,
              r.media_type, r.published_at, r.views, r.likes, r.comments, r.outlier_ratio, r.source_url],
          );
          posts++;
          if ((r.outlier_ratio ?? 0) >= 2.5) winners++;
        }
      } catch (err) {
        console.warn(`[competitors] ${platform}/${handle}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return { posts, winners };
}

/** Comments on competitor YouTube winners: unanswered questions are white space. */
export async function ingestCompetitorComments(db: Db, workspaceId: string, perWorkspace = 5): Promise<number> {
  const key = config().YOUTUBE_API_KEY;
  if (!key) return 0;
  const vids = await db.query<{ platform_post_id: string }>(
    `select platform_post_id from competitor_posts
     where workspace_id = $1 and platform = 'youtube' and outlier_ratio >= 1.5
     order by published_at desc nulls last limit $2`,
    [workspaceId, perWorkspace],
  );
  let n = 0;
  for (const v of vids.rows) {
    const comments = await youtubeComments(v.platform_post_id, { key }).catch(() => []);
    n += await storeComments(db, workspaceId, "competitor", "youtube" satisfies Platform, v.platform_post_id, comments);
  }
  return n;
}
