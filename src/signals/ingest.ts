import type { Db } from "../db.js";
import { newId } from "../lib/ids.js";
import { ownProvider } from "../providers/registry.js";
import type { AccountRef, RawComment, SignalRecord, TokenResolver } from "../providers/types.js";
import { fetchTrendingNow } from "../providers/signals/googleTrendsRss.js";
import { wikipediaMomentum } from "../providers/signals/wikipedia.js";
import { youtubeMostPopular } from "../providers/signals/youtubeMostPopular.js";
import { stackExchangeQuestions } from "../providers/signals/stackexchange.js";
import { hackerNewsStories } from "../providers/signals/hackernews.js";
import type { Platform } from "../types.js";
import { isQuestion } from "./questions.js";

export async function storeSignals(db: Db, workspaceId: string | null, signals: SignalRecord[]): Promise<number> {
  let n = 0;
  for (const s of signals) {
    const r = await db.query(
      `insert into signals (id, workspace_id, source, topic, title, url, geo, momentum, payload, observed_at, observed_day)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,($10::timestamptz at time zone 'utc')::date)
       on conflict (coalesce(workspace_id, ''), source, topic, coalesce(geo, ''), observed_day)
       do update set momentum = excluded.momentum, payload = excluded.payload, fetched_at = now()`,
      [newId("sig"), workspaceId, s.source, s.topic.slice(0, 500), s.title, s.url, s.geo, s.momentum, JSON.stringify(s.payload), s.observed_at],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

export async function storeComments(
  db: Db, workspaceId: string, origin: "own" | "competitor", platform: Platform, platformPostId: string, comments: RawComment[],
): Promise<number> {
  let n = 0;
  for (const c of comments) {
    if (!c.platform_comment_id) continue;
    const r = await db.query(
      `insert into audience_comments (id, workspace_id, origin, platform, platform_post_id, platform_comment_id, text,
          like_count, is_question, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (platform, platform_comment_id) do nothing`,
      [newId("cmt"), workspaceId, origin, platform, platformPostId, c.platform_comment_id, c.text.slice(0, 4000),
        c.like_count, isQuestion(c.text), c.published_at],
    );
    n += r.rowCount ?? 0;
  }
  return n;
}

/** Global feeds, once per country per night (shared by every workspace in that country). */
export async function ingestGlobalSignals(db: Db, geos: string[]): Promise<number> {
  let n = 0;
  for (const geo of geos) {
    n += await storeSignals(db, null, await fetchTrendingNow(geo).catch(() => []));
    n += await storeSignals(db, null, await youtubeMostPopular(geo).catch(() => []));
  }
  return n;
}

/** Workspace signals: pillar momentum, niche questions and the audience's own comments. */
export async function ingestWorkspaceSignals(db: Db, tokens: TokenResolver, workspaceId: string): Promise<number> {
  const bb = await db.query<{ pillars: string[]; language: string; audience: string | null }>(
    "select pillars, language, audience from brand_brains where workspace_id = $1", [workspaceId],
  );
  const brain = bb.rows[0];
  if (!brain) return 0;
  const lang = brain.language.split("-")[0] ?? "en";
  let n = 0;
  for (const pillar of brain.pillars) {
    const wiki = await wikipediaMomentum(pillar, lang).catch(() => null);
    if (wiki) n += await storeSignals(db, workspaceId, [wiki]);
    n += await storeSignals(db, workspaceId, await stackExchangeQuestions(pillar).catch(() => []));
    n += await storeSignals(db, workspaceId, await hackerNewsStories(pillar).catch(() => []));
  }
  n += await ingestOwnComments(db, tokens, workspaceId);
  return n;
}

/** Comments on the brand's own posts from the last 14 days: the best idea source. */
export async function ingestOwnComments(db: Db, tokens: TokenResolver, workspaceId: string): Promise<number> {
  const posts = await db.query<{ platform: Platform; platform_post_id: string; account: AccountRef }>(
    `select p.platform, p.platform_post_id,
            json_build_object('id', a.id, 'platform', a.platform, 'external_account_id', a.external_account_id,
              'handle', a.handle, 'account_kind', a.account_kind, 'studio_connection_id', a.studio_connection_id) as account
     from published_posts p
     join connected_accounts a on a.workspace_id = p.workspace_id and a.platform = p.platform and a.disconnected_at is null
     where p.workspace_id = $1 and p.published_at > now() - interval '14 days'`,
    [workspaceId],
  );
  let n = 0;
  for (const p of posts.rows) {
    try {
      const token = await tokens.accessToken(p.account);
      const comments = await ownProvider(p.platform).fetchComments(p.account, token, p.platform_post_id);
      n += await storeComments(db, workspaceId, "own", p.platform, p.platform_post_id, comments);
    } catch (err) {
      console.warn(`[comments] ${p.platform}/${p.platform_post_id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return n;
}
