import type { Db } from "../db.js";
import { BrandBrain } from "../contracts/brandBrain.js";
import { researchBrand, type BrandDraft } from "../research/brand.js";
import type { Goal } from "../types.js";

export { htmlToText } from "../research/website.js";

/**
 * Brand Brain builder: researched from the website and the web, confirmed by
 * the user. Only confirmed brains drive ideation.
 */
export async function draftBrandBrain(
  db: Db,
  workspaceId: string,
  input: { website_url: string; goal: Goal; language?: string | null },
): Promise<BrandDraft> {
  return researchBrand(db, workspaceId, input);
}

/** The user confirms (and edits) the draft. */
export async function confirmBrandBrain(
  db: Db, workspaceId: string, brain: BrandBrain & { timezone?: string; trends_geo?: string | null },
): Promise<void> {
  const b = BrandBrain.parse(brain);
  await db.query(
    `insert into brand_brains (workspace_id, website_url, brand_kit, goal, language, timezone, trends_geo, tone_words, pillars,
        audience, offers, banned_topics, description, industry, country, social_links, confirmed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
     on conflict (workspace_id) do update set website_url = excluded.website_url, brand_kit = excluded.brand_kit,
       goal = excluded.goal, language = excluded.language, timezone = excluded.timezone, trends_geo = excluded.trends_geo,
       tone_words = excluded.tone_words, pillars = excluded.pillars, audience = excluded.audience, offers = excluded.offers,
       banned_topics = excluded.banned_topics, description = excluded.description, industry = excluded.industry,
       country = excluded.country, social_links = excluded.social_links, confirmed_at = now(), updated_at = now()`,
    [workspaceId, b.website_url, JSON.stringify(b.brand_kit), b.goal, b.language, brain.timezone ?? "UTC",
      brain.trends_geo ?? b.country ?? (b.language.split("-")[1] ?? null), b.tone_words, b.pillars, b.audience, JSON.stringify(b.offers),
      b.banned_topics, b.description ?? null, b.industry ?? null, b.country ?? null, JSON.stringify(b.social_links)],
  );
}
