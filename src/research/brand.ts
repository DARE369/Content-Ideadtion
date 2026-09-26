import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "../db.js";
import { research, structured } from "../ai/client.js";
import { REVENUE_ROLES, SOCIAL_PLATFORMS, type BrandBrain, type Offer, type SocialLink } from "../contracts/brandBrain.js";
import type { Goal, Platform } from "../types.js";
import { crawlSite, dedupeSocials, normalizeColor, socialFromUrl, type SiteProfile } from "./website.js";

/**
 * Brand research: read the website, research the company on the web, work out
 * what actually earns the money, and find the competitors that sell the same
 * things in the same markets. Two Claude calls: a research turn with web tools
 * (free-form notes with sources), then a structuring pass that turns the notes
 * and the site's own metadata into the Brand Brain draft.
 */

export const MAX_COMPETITORS = 5;

const RESEARCH_ROLE = `You are a brand strategist researching a company before planning its social content. Be factual and specific; never guess when you can check. Use the website text provided and web search to confirm.

Find out:
1. What the company actually does, in one or two plain sentences, and its industry and markets (countries/regions).
2. Its products and services, and which ones generate the revenue. Mark each as CORE (a main revenue line), SECONDARY (sold, but smaller), or LEAD MAGNET (free or low-cost, used to win customers). Give prices if public, and the page URL.
3. Who buys: the customer segments (B2B vs consumer, job titles or life situations, sectors).
4. Its public social media profiles (full URLs). Only include profiles you actually found.
5. Its competitors: 6-10 companies that sell the SAME core products to the SAME kind of customer in the SAME markets. Prefer direct competitors over famous giants from other markets. For each: name, website, why they compete, which of this company's products they overlap with, and their public social handles if you find them (Instagram, YouTube, TikTok, LinkedIn, Facebook).

Write concise notes with a "Sources" list of the URLs you relied on.`;

const STRUCTURE_ROLE = `You turn research notes and website metadata into a structured brand profile for a content engine. Keep only what the notes or the website support; leave a field empty rather than invent. Content pillars are 3-5 recurring themes the brand can credibly post about, tied to what it sells. Tone words are 3-5 adjectives. Brand colours are hex codes: prefer colours visible in the logo, then the website's CSS candidates.`;

const Profile = z.object({
  name: z.string(),
  description: z.string().describe("one or two plain sentences on what the company does and for whom"),
  industry: z.string(),
  country: z.string().describe("ISO 3166 alpha-2 of the main market, or empty"),
  language: z.string().describe("BCP 47 content language and locale for posts, e.g. en-NG"),
  audience: z.string().describe("who buys, specific"),
  pillars: z.array(z.string()),
  tone_words: z.array(z.string()),
  products: z.array(z.object({
    name: z.string(),
    description: z.string(),
    category: z.string(),
    revenue_role: z.enum(REVENUE_ROLES),
    price: z.string().describe("empty if not public"),
    url: z.string().describe("empty if unknown"),
  })),
  social_links: z.array(z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: z.string() })),
  brand_colors: z.array(z.string()).describe("hex codes like #1a7f37"),
  banned_topics: z.array(z.string()).describe("topics this brand should avoid, e.g. politics; can be empty"),
  competitors: z.array(z.object({
    name: z.string(),
    website: z.string().describe("empty if unknown"),
    why: z.string().describe("one sentence: why they compete"),
    overlap: z.array(z.string()).describe("names of this company's products they compete with"),
    market: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    instagram: z.string().describe("handle without @, empty if unknown"),
    youtube: z.string().describe("@handle or channel id, empty if unknown"),
    tiktok: z.string().describe("handle without @, empty if unknown"),
    linkedin: z.string().describe("company page URL, empty if unknown"),
    facebook: z.string().describe("page URL, empty if unknown"),
  })),
});
type Profile = z.infer<typeof Profile>;

export interface CompetitorSuggestion {
  name: string;
  website: string | null;
  why: string;
  overlap: string[];
  market: string;
  confidence: "high" | "medium" | "low";
  handles: Partial<Record<Platform, string>>;
}

export interface BrandDraft {
  brain: BrandBrain;
  name: string;
  logos: string[];
  competitor_suggestions: CompetitorSuggestion[];
  researched_with_web: boolean;
  site_reachable: boolean;
}

const isUrl = (s: string) => /^https?:\/\/[^\s]+\.[^\s]+/.test(s);
const clean = (s: string | undefined | null) => (s ?? "").trim();

function siteBlock(site: SiteProfile): string {
  if (!site.reachable) return `The website ${site.url} could not be read directly (it may render in the browser only). Rely on web search.`;
  return [
    `Website: ${site.url}`,
    site.name ? `Name in metadata: ${site.name}` : null,
    site.description ? `Meta description: ${site.description}` : null,
    site.language ? `Page language/locale: ${site.language}` : null,
    site.socials.length ? `Social links on the site: ${site.socials.map((s) => s.url).join(", ")}` : null,
    site.cssColors.length ? `Website CSS colour candidates: ${site.cssColors.join(", ")}` : null,
    "",
    ...site.pages.map((p) => `--- Page: ${p.url}${p.title ? ` (${p.title})` : ""}\n${p.text}`),
  ].filter((x) => x !== null).join("\n");
}

function logoBlock(site: SiteProfile): Anthropic.ContentBlockParam[] {
  const logo = site.logos.find((l) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(l));
  return logo ? [{ type: "image", source: { type: "url", url: logo } }, { type: "text", text: "Above: the brand's logo from its website." }] : [];
}

function toSuggestion(c: Profile["competitors"][number]): CompetitorSuggestion {
  const handles: Partial<Record<Platform, string>> = {};
  const ig = clean(c.instagram).replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/.*$/, "");
  if (/^[A-Za-z0-9._]{2,30}$/.test(ig)) handles.instagram = ig;
  const yt = clean(c.youtube).replace(/^https?:\/\/(www\.)?youtube\.com\//, "");
  if (/^(@[\w.-]{2,}|UC[\w-]{20,})$/.test(yt)) handles.youtube = yt;
  const tt = clean(c.tiktok).replace(/^@/, "").replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/, "").replace(/\/.*$/, "");
  if (/^[\w.]{2,24}$/.test(tt)) handles.tiktok = tt;
  if (isUrl(clean(c.linkedin))) handles.linkedin = clean(c.linkedin);
  if (isUrl(clean(c.facebook))) handles.facebook = clean(c.facebook);
  const site = clean(c.website);
  return {
    name: clean(c.name),
    website: site ? (site.startsWith("http") ? site : `https://${site}`) : null,
    why: clean(c.why),
    overlap: c.overlap.map(clean).filter(Boolean),
    market: clean(c.market),
    confidence: c.confidence,
    handles,
  };
}

const CONF = { high: 0, medium: 1, low: 2 } as const;

/** Merge what the site publishes (reliable) with what research found. */
export function mergeProfile(site: SiteProfile, p: Profile, input: { website_url: string; goal: Goal; language?: string | null }): Omit<BrandDraft, "researched_with_web" | "site_reachable"> {
  const colors = [...new Set([...p.brand_colors, ...site.cssColors].map((c) => normalizeColor(c)).filter((c): c is string => !!c))].slice(0, 6);
  const socials: SocialLink[] = dedupeSocials([
    ...site.socials,
    ...p.social_links.map((s) => socialFromUrl(s.url) ?? (isUrl(s.url) ? { platform: s.platform, url: s.url } : null)).filter((s): s is SocialLink => !!s),
  ]);
  const offers: Offer[] = p.products.filter((x) => clean(x.name)).map((x) => ({
    name: clean(x.name),
    ...(clean(x.description) ? { description: clean(x.description) } : {}),
    ...(clean(x.category) ? { category: clean(x.category) } : {}),
    revenue_role: x.revenue_role,
    ...(clean(x.price) ? { price: clean(x.price) } : {}),
    ...(isUrl(clean(x.url)) ? { url: clean(x.url) } : {}),
  })).sort((a, b) => REVENUE_ROLES.indexOf(a.revenue_role!) - REVENUE_ROLES.indexOf(b.revenue_role!));
  const country = /^[A-Za-z]{2}$/.test(clean(p.country)) ? clean(p.country).toUpperCase() : site.country;
  const language = input.language || (/^[a-z]{2}(-[A-Z]{2})?$/.test(clean(p.language)) ? clean(p.language) : null) || site.language || "en";
  const logo = site.logos[0];
  const brain: BrandBrain = {
    website_url: input.website_url,
    description: clean(p.description) || site.description || undefined,
    industry: clean(p.industry) || undefined,
    country: country ?? null,
    brand_kit: { colors, fonts: [], ...(logo ? { logo_url: logo } : {}) },
    social_links: socials,
    goal: input.goal,
    language,
    tone_words: p.tone_words.map(clean).filter(Boolean).slice(0, 8),
    pillars: p.pillars.map(clean).filter(Boolean).slice(0, 6),
    audience: clean(p.audience),
    offers,
    banned_topics: p.banned_topics.map(clean).filter(Boolean),
  };
  const ownHost = (() => { try { return new URL(input.website_url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const competitors = p.competitors.map(toSuggestion)
    .filter((c) => c.name && !(c.website && c.website.includes(ownHost) && ownHost))
    .sort((a, b) => CONF[a.confidence] - CONF[b.confidence]);
  return { brain, name: clean(p.name) || site.name || ownHost, logos: site.logos, competitor_suggestions: competitors };
}

async function structure(db: Db, workspaceId: string, notes: string, site: SiteProfile, withLogo: boolean): Promise<Profile> {
  return structured({
    db, task: "brand_brain:structure", workspaceId, tier: "strategy",
    system: [STRUCTURE_ROLE],
    content: [
      ...(withLogo ? logoBlock(site) : []),
      { type: "text", text: `Research notes:\n${notes || "(none)"}\n\nWebsite metadata:\n${siteBlock({ ...site, pages: [] })}` },
    ],
    schema: Profile,
  });
}

export async function researchBrand(
  db: Db, workspaceId: string, input: { website_url: string; goal: Goal; language?: string | null },
): Promise<BrandDraft> {
  const site = await crawlSite(input.website_url);
  const notes = await research({
    db, task: "brand_brain:research", workspaceId,
    system: [RESEARCH_ROLE],
    content: `${siteBlock(site)}\n\nResearch this company: ${input.website_url}`,
  });
  let profile: Profile;
  try {
    profile = await structure(db, workspaceId, notes.text, site, true);
  } catch {
    // The logo URL can be unreachable for the API; retry without the image.
    profile = await structure(db, workspaceId, notes.text, site, false);
  }
  const merged = mergeProfile(site, profile, input);
  await db.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, draft, competitor_suggestions, research)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (workspace_id) do update set draft = excluded.draft, competitor_suggestions = excluded.competitor_suggestions,
       research = excluded.research, updated_at = now()`,
    [workspaceId, input.website_url, input.goal, merged.brain.language, JSON.stringify({ ...merged.brain, name: merged.name, logos: merged.logos }),
      JSON.stringify(merged.competitor_suggestions), JSON.stringify({ notes: notes.text, searched: notes.searched, site_reachable: site.reachable, at: new Date().toISOString() })],
  );
  return { ...merged, researched_with_web: notes.searched, site_reachable: site.reachable };
}

const COMPETITOR_ROLE = `You research competitors for a company's social content strategy. Find 6-10 companies that sell the SAME core products to the SAME kind of customer in the SAME markets. Prefer direct, similar-sized competitors over global giants from other markets, and skip the company itself. For each: name, website, one sentence on why they compete, which of the company's products they overlap with, the market, your confidence, and their public social handles if you can find them. Use web search to check.`;

const CompetitorList = z.object({ competitors: Profile.shape.competitors });

/** Re-run competitor research from an existing Brand Brain (Settings → Competitors). */
export async function researchCompetitors(db: Db, workspaceId: string): Promise<CompetitorSuggestion[]> {
  const r = await db.query<BrandBrain & { name: string }>(
    `select w.name, b.* from brand_brains b join workspaces w on w.id = b.workspace_id where b.workspace_id = $1`, [workspaceId],
  );
  const b = r.rows[0];
  if (!b) throw new Error("Set up the Brand Brain first.");
  const brief = [
    `Company: ${b.name}${b.website_url ? ` (${b.website_url})` : ""}`,
    b.description ? `What it does: ${b.description}` : null,
    b.industry ? `Industry: ${b.industry}` : null,
    b.country ? `Main market: ${b.country}` : null,
    `Customers: ${b.audience}`,
    `Products and services:\n${(b.offers ?? []).map((o) => `- ${o.name}${o.revenue_role ? ` [${o.revenue_role}]` : ""}${o.description ? `: ${o.description}` : ""}`).join("\n")}`,
  ].filter(Boolean).join("\n");
  const notes = await research({ db, task: "competitors:research", workspaceId, system: [COMPETITOR_ROLE], content: brief, maxFetches: 2 });
  const out = await structured({
    db, task: "competitors:structure", workspaceId, tier: "fast", system: [STRUCTURE_ROLE],
    content: `Company:\n${brief}\n\nCompetitor research notes:\n${notes.text}`,
    schema: CompetitorList,
  });
  const own = (b.website_url ?? "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0] ?? "";
  const list = out.competitors.map(toSuggestion).filter((c) => c.name && !(own && c.website?.includes(own)))
    .sort((a, b) => CONF[a.confidence] - CONF[b.confidence]);
  await db.query("update brand_brains set competitor_suggestions = $2, updated_at = now() where workspace_id = $1", [workspaceId, JSON.stringify(list)]);
  return list;
}

/** Add chosen suggestions as tracked competitors, never beyond MAX_COMPETITORS. */
export async function addSuggestedCompetitors(
  db: Db, workspaceId: string, pick: { names?: string[]; auto?: boolean },
): Promise<{ added: string[]; skipped: string[]; limit: number }> {
  const [sugg, existing] = await Promise.all([
    db.query<{ competitor_suggestions: CompetitorSuggestion[] }>("select competitor_suggestions from brand_brains where workspace_id = $1", [workspaceId]),
    db.query<{ name: string }>("select name from competitors where workspace_id = $1", [workspaceId]),
  ]);
  const have = new Set(existing.rows.map((r) => r.name.toLowerCase()));
  const all = (sugg.rows[0]?.competitor_suggestions ?? []).filter((s) => !have.has(s.name.toLowerCase()));
  const slots = Math.max(0, MAX_COMPETITORS - existing.rows.length);
  const wanted = pick.auto ? all : all.filter((s) => pick.names?.some((n) => n.toLowerCase() === s.name.toLowerCase()));
  const chosen = wanted.slice(0, slots);
  const { newId } = await import("../lib/ids.js");
  for (const c of chosen) {
    await db.query(
      "insert into competitors (id, workspace_id, name, handles) values ($1,$2,$3,$4)",
      [newId("cmp"), workspaceId, c.name, JSON.stringify({ ...c.handles, ...(c.website ? { website: c.website } : {}) })],
    );
  }
  return { added: chosen.map((c) => c.name), skipped: wanted.slice(slots).map((c) => c.name), limit: MAX_COMPETITORS };
}
