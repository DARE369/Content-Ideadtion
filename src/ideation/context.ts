import type { Db } from "../db.js";
import type { BrandBrain } from "../contracts/brandBrain.js";
import { loadEstimates, probBeatsBaseline } from "../learning/model.js";
import { isPlatform, type Goal, type Platform } from "../types.js";

/** Everything the ideator sees, loaded once per run. Own evidence first. */

export interface WorkspaceBrain extends BrandBrain {
  workspace_id: string;
  name: string;
  timezone: string;
  trends_geo: string | null;
}

export async function loadBrain(db: Db, workspaceId: string): Promise<WorkspaceBrain | null> {
  const r = await db.query(
    `select w.id as workspace_id, w.name, b.website_url, b.brand_kit, b.goal, b.language, b.timezone, b.trends_geo,
            b.tone_words, b.pillars, coalesce(b.audience, '') as audience, b.offers, b.banned_topics,
            b.description, b.industry, b.country, b.social_links, b.buyer_questions, b.objections
     from workspaces w join brand_brains b on b.workspace_id = w.id
     where w.id = $1 and b.confirmed_at is not null`,
    [workspaceId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    ...row,
    description: row.description ?? undefined,
    industry: row.industry ?? undefined,
    social_links: row.social_links ?? [],
    buyer_questions: row.buyer_questions ?? [],
    objections: row.objections ?? [],
    brand_kit: { colors: [], fonts: [], ...row.brand_kit },
    goal: row.goal as Goal,
  };
}

export async function connectedPlatforms(db: Db, workspaceId: string): Promise<Platform[]> {
  const r = await db.query<{ platform: string }>(
    "select distinct platform from connected_accounts where workspace_id = $1 and disconnected_at is null order by platform",
    [workspaceId],
  );
  return r.rows.map((x) => x.platform).filter(isPlatform);
}

export interface OwnPostRow {
  id: string; platform: string; published_at: string; pi: number | null; goal_index: number | null;
  views: number | null; caption: string | null; features: Record<string, string>;
}

export interface IdeationContext {
  brain: WorkspaceBrain;
  platforms: Platform[];
  ownPosts: OwnPostRow[];
  competitorWinners: { id: string; platform: string; outlier_ratio: number; title: string | null; caption: string | null; tags: unknown; url: string | null }[];
  /** Trend feeds and the web market scan (source claude_web_search, with kind/summary/date/product). */
  signals: {
    id: string; source: string; title: string | null; momentum: number | null; url: string | null;
    kind?: string | null; summary?: string | null; published?: string | null; product?: string | null;
  }[];
  questions: { id: string; origin: string; platform: string; text: string; like_count: number | null }[];
  rules: { platform: string | null; feature: string; value: string; action: string; share: number | null; rationale: string }[];
  patterns: { platform: Platform; feature: string; value: string; n: number; p_beat: number; label: "proven" | "unproven" | "weak" }[];
  postsWithResults: Record<string, number>;
}

export async function loadContext(db: Db, workspaceId: string): Promise<IdeationContext | null> {
  const brain = await loadBrain(db, workspaceId);
  if (!brain) return null;
  const platforms = await connectedPlatforms(db, workspaceId);

  const own = await db.query<OwnPostRow>(
    `select p.id, p.platform, p.published_at::text, m.pi::float8 as pi, m.goal_index::float8 as goal_index,
            m.views::float8 as views, left(p.caption, 280) as caption, p.features
     from published_posts p left join mv_post_performance m on m.post_id = p.id
     where p.workspace_id = $1
     order by p.published_at desc limit 40`,
    [workspaceId],
  );

  const winners = await db.query(
    `select id, platform, outlier_ratio::float8 as outlier_ratio, title, left(caption, 280) as caption, vision_tags as tags, permalink as url
     from competitor_posts where workspace_id = $1 and outlier_ratio >= 2.5
     order by published_at desc nulls last limit 25`,
    [workspaceId],
  );

  // The market scan gets its own quota so generic trend feeds can't crowd it out.
  const signals = await db.query(
    `(select id, source, coalesce(title, topic) as title, momentum::float8 as momentum, url,
             payload->>'kind' as kind, payload->>'summary' as summary, payload->>'published' as published, payload->>'product' as product
      from signals where workspace_id = $1 and source = 'claude_web_search' and observed_at > now() - interval '10 days'
      order by momentum desc nulls last, observed_at desc limit 15)
     union all
     (select id, source, coalesce(title, topic) as title, momentum::float8 as momentum, url, null, null, null, null
      from signals where (workspace_id = $1 or (workspace_id is null and geo = $2)) and source <> 'claude_web_search'
        and observed_at > now() - interval '7 days'
      order by momentum desc nulls last, observed_at desc limit 20)`,
    [workspaceId, brain.trends_geo],
  );

  const questions = await db.query(
    `select id, origin, platform, left(text, 300) as text, like_count from audience_comments
     where workspace_id = $1 and is_question and published_at > now() - interval '30 days'
     order by origin = 'own' desc, like_count desc nulls last limit 30`,
    [workspaceId],
  );

  const rules = await db.query(
    `select platform, feature, value, action, share::float8 as share, rationale from guidance_rules
     where workspace_id = $1 and active_from <= now() and (active_until is null or active_until > now())`,
    [workspaceId],
  );

  const patterns: IdeationContext["patterns"] = [];
  for (const p of platforms) {
    for (const e of (await loadEstimates(db, workspaceId, p)).byKey.values()) {
      if (e.n === 0) continue;
      const pb = probBeatsBaseline(e.mu_hat, e.se);
      patterns.push({ platform: p, feature: e.feature, value: e.value, n: e.n, p_beat: pb, label: pb >= 0.7 ? "proven" : pb <= 0.3 ? "weak" : "unproven" });
    }
  }

  const counts = await db.query<{ platform: string; posts_with_pi: string }>(
    "select platform, posts_with_pi from v_platform_post_counts where workspace_id = $1", [workspaceId],
  );

  return {
    brain,
    platforms,
    ownPosts: own.rows,
    competitorWinners: winners.rows,
    signals: signals.rows,
    questions: questions.rows,
    rules: rules.rows,
    patterns: patterns.sort((a, b) => b.p_beat - a.p_beat),
    postsWithResults: Object.fromEntries(counts.rows.map((r) => [r.platform, Number(r.posts_with_pi)])),
  };
}

/** The volatile part of the prompt (after the cached prefix), as compact tables. */
export function renderContext(ctx: IdeationContext): string {
  const fmt = (n: number | null, d = 2) => (n == null ? "–" : n.toFixed(d));
  const lines: string[] = [];
  lines.push(`Connected platforms: ${ctx.platforms.join(", ") || "none (write general ideas)"}`);
  lines.push("", "## Own posts (newest first). PI = views at 72h / brand's median; >1 beat the baseline");
  lines.push("id | platform | PI | goal index | features | caption");
  for (const p of ctx.ownPosts) {
    lines.push(`${p.id} | ${p.platform} | ${fmt(p.pi)} | ${fmt(p.goal_index)} | ${Object.entries(p.features).filter(([k]) => !k.startsWith("posting")).map(([k, v]) => `${k}=${v}`).join(",")} | ${(p.caption ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
  }
  lines.push("", "## Learned patterns (p_beat = chance a post with this feature beats the baseline)");
  lines.push("platform | feature=value | posts | p_beat | label");
  for (const p of ctx.patterns.slice(0, 40)) lines.push(`${p.platform} | ${p.feature}=${p.value} | ${p.n} | ${p.p_beat.toFixed(2)} | ${p.label}`);
  lines.push("", "## Audience questions (own comments first)");
  for (const q of ctx.questions) lines.push(`${q.id} | ${q.origin} ${q.platform} | likes ${q.like_count ?? 0} | ${q.text.replace(/\s+/g, " ")}`);
  lines.push("", "## Competitor winners (>= 2.5x their own median)");
  for (const w of ctx.competitorWinners) lines.push(`${w.id} | ${w.platform} | ${w.outlier_ratio.toFixed(1)}x | ${(w.title ?? w.caption ?? "").replace(/\s+/g, " ").slice(0, 160)} | tags ${JSON.stringify(w.tags ?? {})}`);
  const market = ctx.signals.filter((s) => s.source === "claude_web_search");
  lines.push("", "## Market scan: what buyers are paying attention to now (web, cited). Prefer these for \"why now\".");
  lines.push("id | kind | date | relevance | makes relevant | headline — why buyers care");
  for (const s of market) lines.push(`${s.id} | ${s.kind ?? "news"} | ${s.published ?? "?"} | ${fmt(s.momentum)} | ${s.product ?? "–"} | ${s.title ?? ""} — ${s.summary ?? ""}`);
  lines.push("", "## Trend signals (momentum 0-1, >0.5 rising)");
  for (const s of ctx.signals.filter((x) => x.source !== "claude_web_search")) lines.push(`${s.id} | ${s.source} | ${fmt(s.momentum)} | ${s.title ?? ""}`);
  lines.push("", "## Active guidance rules from the last report");
  for (const r of ctx.rules) lines.push(`${r.platform ?? "all"} | ${r.action} ${r.feature}=${r.value}${r.share != null ? ` in ${Math.round(r.share * 100)}% of posts` : ""} | ${r.rationale}`);
  return lines.join("\n");
}
