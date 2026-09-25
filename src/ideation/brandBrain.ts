import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { BRAND_DRAFT_ROLE } from "../ai/prompts/reports.js";
import { BrandBrain } from "../contracts/brandBrain.js";
import { fetchText } from "../lib/http.js";
import type { Goal } from "../types.js";

/**
 * Brand Brain builder: drafted automatically from the website, confirmed by the
 * user in under 5 minutes. Only confirmed brains drive ideation.
 */

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export async function draftBrandBrain(
  db: Db,
  workspaceId: string,
  input: { website_url: string; goal: Goal; language: string; competitors?: string[] },
): Promise<BrandBrain> {
  const html = await fetchText(input.website_url, { limitKey: "websites", maxRetries: 1 }).catch(() => "");
  const text = htmlToText(html).slice(0, 30_000);
  const draft = await structured({
    db, task: "brand_brain:draft", workspaceId, tier: "fast",
    system: [BRAND_DRAFT_ROLE],
    content: `Website: ${input.website_url}\nPrimary goal (set by the owner): ${input.goal}\nContent language/locale (set by the owner): ${input.language}\n\nWebsite text:\n${text || "(could not fetch the site; draft only from the URL and leave unknowns short)"}`,
    schema: BrandBrain,
  });
  const brain: BrandBrain = { ...draft, website_url: input.website_url, goal: input.goal, language: input.language };
  await db.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, draft) values ($1,$2,$3,$4,$5)
     on conflict (workspace_id) do update set draft = excluded.draft, updated_at = now()`,
    [workspaceId, input.website_url, input.goal, input.language, JSON.stringify(brain)],
  );
  return brain;
}

/** The user confirms (and edits) the draft. */
export async function confirmBrandBrain(
  db: Db, workspaceId: string, brain: BrandBrain & { timezone?: string; trends_geo?: string | null },
): Promise<void> {
  const b = BrandBrain.parse(brain);
  await db.query(
    `insert into brand_brains (workspace_id, website_url, brand_kit, goal, language, timezone, trends_geo, tone_words, pillars,
        audience, offers, banned_topics, confirmed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (workspace_id) do update set website_url = excluded.website_url, brand_kit = excluded.brand_kit,
       goal = excluded.goal, language = excluded.language, timezone = excluded.timezone, trends_geo = excluded.trends_geo,
       tone_words = excluded.tone_words, pillars = excluded.pillars, audience = excluded.audience, offers = excluded.offers,
       banned_topics = excluded.banned_topics, confirmed_at = now(), updated_at = now()`,
    [workspaceId, b.website_url, JSON.stringify(b.brand_kit), b.goal, b.language, brain.timezone ?? "UTC",
      brain.trends_geo ?? (b.language.split("-")[1] ?? null), b.tone_words, b.pillars, b.audience, JSON.stringify(b.offers), b.banned_topics],
  );
}
