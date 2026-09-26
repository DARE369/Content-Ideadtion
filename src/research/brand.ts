import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "../db.js";
import { research, structured } from "../ai/client.js";
import { REVENUE_ROLES, SOCIAL_PLATFORMS, type BrandBrain, type Offer, type SocialLink } from "../contracts/brandBrain.js";
import type { Goal, Platform } from "../types.js";
import { crawlSite, dedupeSocials, guessLocale, normalizeColor, socialFromUrl, type SiteProfile } from "./website.js";

/**
 * Brand research: read the website, research the company on the web, work out
 * what actually earns the money, and find the competitors that sell the same
 * things in the same markets. Two Claude calls: a research turn with web tools
 * (free-form notes with sources), then a structuring pass that turns the notes
 * and the site's own metadata into the Brand Brain draft.
 */

export const MAX_COMPETITORS = 5;

const RESEARCH_ROLE = `You are a brand strategist researching a company before planning its social content. Be factual and specific; never guess when you can check. Use the website text provided and web search to confirm. Keep it quick: a few targeted searches, and write your findings down as you go.

Find out:
1. What the company actually does, in one or two plain sentences, and its industry and markets (countries/regions).
2. Its products and services, and which ones generate the revenue. Mark each as CORE (a main revenue line), SECONDARY (sold, but smaller), or LEAD MAGNET (free or low-cost, used to win customers). Give prices if public, and the page URL.
3. Who buys: the customer segments (B2B vs consumer, job titles or life situations, sectors).
4. What buyers ask before they buy (in their words) and what makes them hesitate (price, risk, switching cost, trust, proof). Look at FAQs, reviews, forums and industry discussions.
5. Its public social media profiles (full URLs). Only include profiles you actually found.
6. Its competitors: 6-10 companies that sell the SAME core products to the SAME kind of customer in the SAME markets. Prefer direct competitors over famous giants from other markets. For each: name, website, why they compete, which of this company's products they overlap with, and their public social handles if you find them (Instagram, YouTube, TikTok, LinkedIn, Facebook).

Write concise notes with a "Sources" list of the URLs you relied on.`;

const STRUCTURE_ROLE = `You turn research notes and website metadata into a structured brand profile for a content engine. Keep only what the notes or the website support; leave a field empty rather than invent. Content pillars are 3-5 recurring themes the brand can credibly post about, tied to what it sells. Tone words are 3-5 adjectives. Brand colours are hex codes: prefer colours visible in the logo, then the website's CSS candidates.`;

const Profile = z.object({
  name: z.string(),
  description: z.string().describe("one or two plain sentences on what the company does and for whom"),
  industry: z.string(),
  country: z.string().describe("ISO 3166 alpha-2 of the main market, or empty"),
  language: z.string().describe("BCP 47 content language and locale for posts, e.g. en-NG"),
  audience: z.string().describe("who buys, specific"),
  buyer_questions: z.array(z.string()).describe("3-8 questions buyers ask before buying, in their words"),
  objections: z.array(z.string()).describe("2-6 reasons buyers hesitate"),
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
    buyer_questions: p.buyer_questions.map(clean).filter(Boolean).slice(0, 10),
    objections: p.objections.map(clean).filter(Boolean).slice(0, 10),
    offers,
    banned_topics: p.banned_topics.map(clean).filter(Boolean),
  };
  const ownHost = (() => { try { return new URL(input.website_url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const competitors = p.competitors.map(toSuggestion)
    .filter((c) => c.name && !(c.website && c.website.includes(ownHost) && ownHost))
    .sort((a, b) => CONF[a.confidence] - CONF[b.confidence]);
  return { brain, name: clean(p.name) || site.name || ownHost, logos: site.logos, competitor_suggestions: competitors };
}

/** Time budgets (ms). Each stage is its own HTTP request inside the 300 s function limit. */
export const BUDGET = { crawl: 50_000, research: 200_000, structure: 80_000, structureFallback: 50_000, competitors: 170_000, competitorsStructure: 40_000 };

export interface AnalyseInput { website_url: string; goal: Goal; language?: string | null }

/** What one analysis stage reports back; `warning` is plain language for the user. */
export interface StageResult { ok: boolean; warning?: string }

interface StoredResearch { site?: SiteProfile; notes?: string; searched?: boolean; timed_out?: boolean; error?: string; at?: string }

const USER_AGENT_BLOCKED = "We couldn't open your website. It may be slow, offline, or blocking automated visitors.";

function emptySite(url: string): SiteProfile {
  return { url, reachable: false, name: null, description: null, logos: [], socials: [], cssColors: [], themeColor: null, language: null, country: null, pages: [] };
}

async function loadResearch(db: Db, workspaceId: string): Promise<StoredResearch> {
  const r = await db.query<{ research: StoredResearch | null }>("select research from brand_brains where workspace_id = $1", [workspaceId]);
  return r.rows[0]?.research ?? {};
}

async function saveResearch(db: Db, workspaceId: string, input: AnalyseInput, patch: StoredResearch, replace = false): Promise<void> {
  await db.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, research) values ($1,$2,$3,$4,$5)
     on conflict (workspace_id) do update set research = ${replace ? "excluded.research" : "coalesce(brand_brains.research, '{}'::jsonb) || excluded.research"}, updated_at = now()`,
    [workspaceId, input.website_url, input.goal, input.language || "en", JSON.stringify(patch)],
  );
}

/** Stage 1: read the website (no AI). Starts a fresh analysis. */
export async function analyseSite(db: Db, workspaceId: string, input: AnalyseInput): Promise<StageResult & { name: string | null; logos: string[]; pages: number }> {
  let site: SiteProfile;
  try {
    site = await withDeadline(crawlSite(input.website_url), BUDGET.crawl);
  } catch {
    site = { ...emptySite(input.website_url), ...guessLocale(null, input.website_url) };
  }
  await saveResearch(db, workspaceId, input, { site, at: new Date().toISOString() }, true);
  return {
    ok: site.reachable, name: site.name, logos: site.logos, pages: site.pages.length,
    ...(site.reachable ? {} : { warning: `${USER_AGENT_BLOCKED} We'll research your business on the web instead.` }),
  };
}

/** Stage 2: research on the web. Never throws for AI problems; the draft falls back to the website alone. */
export async function analyseResearch(db: Db, workspaceId: string, input: AnalyseInput): Promise<StageResult & { searched: boolean }> {
  const site = (await loadResearch(db, workspaceId)).site ?? emptySite(input.website_url);
  try {
    const notes = await research({
      db, task: "brand_brain:research", workspaceId,
      system: [RESEARCH_ROLE],
      content: `${siteBlock(site)}\n\nResearch this company: ${input.website_url}`,
      timeoutMs: BUDGET.research,
    });
    await saveResearch(db, workspaceId, input, { notes: notes.text, searched: notes.searched, timed_out: notes.timedOut });
    if (!notes.text) {
      return { ok: false, searched: notes.searched, warning: "Web research ran out of time before finding anything, so your draft is based on your website." };
    }
    return {
      ok: true, searched: notes.searched,
      ...(notes.timedOut ? { warning: "Web research was cut short to save time, so some details may be missing." } : {}),
      ...(!notes.searched ? { warning: "Web search isn't enabled on the Anthropic account, so research used your website only." } : {}),
    };
  } catch (err) {
    console.warn(`[brand research] ${workspaceId}: ${(err as Error).message}`);
    await saveResearch(db, workspaceId, input, { notes: "", error: (err as Error).message });
    return { ok: false, searched: false, warning: `Web research didn't work this time (${researchErrorText(err)}), so your draft is based on your website.` };
  }
}

/** Stage 3: turn everything into the draft. Always returns a draft, even without AI. */
export async function analyseFinish(db: Db, workspaceId: string, input: AnalyseInput): Promise<BrandDraft & { warnings: string[] }> {
  const stored = await loadResearch(db, workspaceId);
  const site = stored.site ?? emptySite(input.website_url);
  const notes = stored.notes ?? "";
  const warnings: string[] = [];
  let profile: Profile | null = null;
  let lastErr: unknown = null;
  const attempts: [tier: "strategy" | "fast", withLogo: boolean, ms: number][] = [["strategy", true, BUDGET.structure], ["fast", false, BUDGET.structureFallback]];
  for (const [tier, withLogo, ms] of attempts) {
    try {
      profile = await structure(db, workspaceId, notes, site, { tier, withLogo, timeoutMs: ms });
      break;
    } catch (err) {
      console.warn(`[brand structure] ${workspaceId} (${tier}): ${(err as Error).message}`);
      lastErr = err;
    }
  }
  if (!profile) {
    profile = siteOnlyProfile(site);
    warnings.push(`The AI couldn't build your profile this time (${structureErrorText(lastErr)}), so we filled in what your website says. Please complete the empty fields, or go back and try again.`);
  }
  const merged = mergeProfile(site, profile, input);
  await db.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, draft, competitor_suggestions) values ($1,$2,$3,$4,$5,$6)
     on conflict (workspace_id) do update set draft = excluded.draft, competitor_suggestions = excluded.competitor_suggestions, updated_at = now()`,
    [workspaceId, input.website_url, input.goal, merged.brain.language, JSON.stringify({ ...merged.brain, name: merged.name, logos: merged.logos }),
      JSON.stringify(merged.competitor_suggestions)],
  );
  return { ...merged, researched_with_web: !!stored.searched && !!notes, site_reachable: site.reachable, warnings };
}

/** All three stages in one call (tests and scripts; the web app calls them one by one). */
export async function researchBrand(db: Db, workspaceId: string, input: AnalyseInput): Promise<BrandDraft & { warnings: string[] }> {
  const a = await analyseSite(db, workspaceId, input);
  const b = await analyseResearch(db, workspaceId, input);
  const c = await analyseFinish(db, workspaceId, input);
  return { ...c, warnings: [a.warning, b.warning, ...c.warnings].filter((w): w is string => !!w) };
}

async function structure(db: Db, workspaceId: string, notes: string, site: SiteProfile, o: { tier: "strategy" | "fast"; withLogo: boolean; timeoutMs: number }): Promise<Profile> {
  // Long research notes: keep the start (the summary) so the answer has room and time to finish.
  notes = notes.length > 24_000 ? `${notes.slice(0, 24_000)}\n[notes shortened]` : notes;
  // Without research notes, the page text is the only source for products and audience.
  const pages = notes ? [] : site.pages.map((p) => ({ ...p, text: p.text.slice(0, 3000) }));
  return structured({
    db, task: "brand_brain:structure", workspaceId, tier: o.tier,
    system: [STRUCTURE_ROLE],
    content: [
      ...(o.withLogo ? logoBlock(site) : []),
      { type: "text", text: `Research notes:\n${notes || "(none; use the website text)"}\n\nWebsite:\n${siteBlock({ ...site, pages })}` },
    ],
    schema: Profile,
    timeoutMs: o.timeoutMs,
    effort: "low",
    maxTokens: o.tier === "strategy" ? 14_000 : 8_000,
  });
}

/** A profile from the website's own metadata, for when the AI can't answer. */
export function siteOnlyProfile(site: SiteProfile): Profile {
  return {
    name: site.name ?? "", description: site.description ?? "", industry: "", country: site.country ?? "", language: site.language ?? "",
    audience: "", buyer_questions: [], objections: [], pillars: [], tone_words: [], products: [], social_links: [], brand_colors: [], banned_topics: [], competitors: [],
  };
}

function structureErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/max_tokens|truncated/i.test(msg)) return "the answer was too long";
  if (/did not match/i.test(msg)) return "the answer came back incomplete";
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || /timed? ?out|abort/i.test(msg))) return "it took too long";
  return researchErrorText(err);
}

function researchErrorText(err: unknown): string {
  const status = (err as { status?: number }).status;
  if (status === 429) return "the AI service is busy";
  if (status === 401) return "the Anthropic API key was rejected";
  if (err instanceof Error && /budget/i.test(err.message)) return "today's AI budget is used up";
  return "the AI service didn't respond";
}

/** Reject if `p` takes longer than `ms`. */
export function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), ms); }),
  ]);
}

const COMPETITOR_ROLE = `You research competitors for a company's social content strategy. Find 6-10 companies that sell the SAME core products to the SAME kind of customer in the SAME markets. Prefer direct, similar-sized competitors over global giants from other markets, and skip the company itself. For each: name, website, one sentence on why they compete, which of the company's products they overlap with, the market, your confidence, and their public social handles if you can find them. Use web search to check. Write each competitor down as soon as you've checked it, so nothing is lost if time runs out.`;

const CompetitorList = z.object({ competitors: Profile.shape.competitors });

export class CompetitorResearchError extends Error {}

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
  const notes = await research({ db, task: "competitors:research", workspaceId, system: [COMPETITOR_ROLE], content: brief, maxSearches: 5, maxFetches: 1, timeoutMs: BUDGET.competitors });
  // Keep the previous list rather than replace it with nothing.
  if (!notes.text) throw new CompetitorResearchError("Competitor research took too long this time. Try again in a minute, or add competitors yourself below.");
  const out = await structured({
    db, task: "competitors:structure", workspaceId, tier: "fast", system: [STRUCTURE_ROLE],
    content: `Company:\n${brief}\n\nCompetitor research notes:\n${notes.text}`,
    schema: CompetitorList,
    timeoutMs: BUDGET.competitorsStructure,
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
