import { createHash } from "node:crypto";

/**
 * Finding a business's pages without any AI: robots.txt, sitemaps, links, and
 * rules that sort pages by what they describe. Everything here is pure and
 * unit-tested; fetching lives in scan.ts.
 */

export const OUR_AGENT = "ContentIdeationEngine";

export interface Robots {
  sitemaps: string[];
  disallow: string[];
  allow: string[];
}

/** Rules for `*` and for our own user agent; sitemap lines from anywhere in the file. */
export function parseRobots(text: string): Robots {
  const out: Robots = { sitemaps: [], disallow: [], allow: [] };
  let applies = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "sitemap") {
      if (value) out.sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      const agent = value.toLowerCase();
      const match = agent === "*" || OUR_AGENT.toLowerCase().includes(agent) || agent.includes(OUR_AGENT.toLowerCase());
      applies = lastWasAgent ? applies || match : match;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies) continue;
    if (key === "disallow" && value) out.disallow.push(value);
    if (key === "allow" && value) out.allow.push(value);
  }
  return out;
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path);
}

/** Longest matching rule wins; Allow wins ties (the common reading of RFC 9309). */
export function isAllowed(robots: Robots, pathAndQuery: string): boolean {
  const best = (rules: string[]) => Math.max(-1, ...rules.filter((r) => ruleMatches(r, pathAndQuery)).map((r) => r.length));
  const d = best(robots.disallow);
  if (d < 0) return true;
  return best(robots.allow) >= d;
}

export interface SitemapResult {
  urls: { loc: string; lastmod: string | null }[];
  sitemaps: string[];
}

export function parseSitemap(xml: string): SitemapResult {
  const out: SitemapResult = { urls: [], sitemaps: [] };
  const clean = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").trim();
  if (/<sitemapindex/i.test(xml)) {
    for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
      const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(m[1]!);
      if (loc) out.sitemaps.push(clean(loc[1]!));
    }
    return out;
  }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(m[1]!);
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(m[1]!);
    if (loc) out.urls.push({ loc: clean(loc[1]!), lastmod: lastmod ? clean(lastmod[1]!) : null });
  }
  return out;
}

export type PageType =
  | "home" | "product" | "service" | "solution" | "pricing" | "case_study" | "faq" | "about" | "industry"
  | "contact" | "blog" | "other" | "skip";

// Keywords may follow "/", "-" or "_" (/our-services, /company_profile).
const RULES: [RegExp, PageType][] = [
  [/(^|[\/_-])(careers?|jobs|vacanc|privacy|terms|legal|cookie|gdpr|login|log-in|signin|sign-in|signup|register|account|cart|checkout|basket|wp-admin|wp-login|feed|rss|search|tag|tags|category|author|page\/\d+|attachment|cdn-cgi|404)(\/|$|\.|-|\?)/i, "skip"],
  [/(^|[\/_-])(pricing|prices|plans|packages|rates|tariff)/i, "pricing"],
  [/(^|[\/_-])(case-stud|casestud|success-stor|portfolio|projects?|clients?|customers?|testimonials?|references?|our-work|work)\w*(\/|$|-|_|\.)/i, "case_study"],
  [/(^|[\/_-])(faqs?|frequently|help|support|how-it-works|how-we-work|process)\w*(\/|$|-|_|\.)/i, "faq"],
  [/(^|[\/_-])(products?|shop|store|catalog|catalogue|collections?|items?|equipment|software|platform|modules?|apps?|tools?)\w*(\/|$|-|_|\.)/i, "product"],
  [/(^|[\/_-])(services?|what-we-do|offerings?|capabilit|expertise)\w*(\/|$|-|_|\.)/i, "service"],
  [/(^|[\/_-])(solutions?|features?|use-cases?)\w*(\/|$|-|_|\.)/i, "solution"],
  [/(^|[\/_-])(industr|sectors?|markets?|who-we-serve)\w*(\/|$|-|_|\.)/i, "industry"],
  [/(^|[\/_-])(about|company|who-we-are|our-story|team|leadership|mission)\w*(\/|$|-|_|\.)/i, "about"],
  [/(^|[\/_-])(contact|locations?|offices?)\w*(\/|$|-|_|\.)/i, "contact"],
  [/(^|[\/_-])(blog|news|insights|articles?|press|media|resources|updates|stories)\w*(\/|$|-|_|\.)/i, "blog"],
];

export const PRIORITY: Record<PageType, number> = {
  home: 3, product: 3, service: 3, solution: 3, pricing: 3, case_study: 3, faq: 3,
  about: 2, industry: 2, contact: 1, blog: 1, other: 1, skip: 0,
};

/** Sort a page by URL path (and link text or title when the path says nothing). */
export function classifyPage(url: string, hint = ""): { type: PageType; priority: number } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { type: "skip", priority: 0 };
  }
  if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|ico|xml|json)$/i.test(u.pathname)) return { type: "skip", priority: 0 };
  const path = u.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || /^\/(index|home)(\.\w+)?$/i.test(path)) return { type: "home", priority: 3 };
  for (const [re, type] of RULES) if (re.test(path)) return { type, priority: PRIORITY[type] };
  const words = hint.toLowerCase();
  for (const [re, type] of RULES) if (type !== "skip" && re.test(`/${words.replace(/\s+/g, "-")}`)) return { type, priority: PRIORITY[type] };
  return { type: "other", priority: 1 };
}

/** Canonical form for de-duplication: no hash, no tracking params, no trailing slash. */
export function canonicalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export interface Candidate { url: string; type: PageType; priority: number; lastmod: string | null }

/**
 * Choose what to read: every high-value page first, then medium, then the
 * newest few low-value ones (blog), up to the budget.
 */
export function choosePages(cands: Candidate[], budget = 40, newestLow = 5): Candidate[] {
  const byUrl = new Map<string, Candidate>();
  for (const c of cands) {
    const k = canonicalUrl(c.url);
    if (!k || c.priority === 0) continue;
    const prev = byUrl.get(k);
    if (!prev || c.priority > prev.priority) byUrl.set(k, { ...c, url: k });
  }
  const all = [...byUrl.values()];
  const high = all.filter((c) => c.priority >= 3);
  const med = all.filter((c) => c.priority === 2);
  const low = all.filter((c) => c.priority === 1)
    .sort((a, b) => (Date.parse(b.lastmod ?? "") || 0) - (Date.parse(a.lastmod ?? "") || 0))
    .slice(0, newestLow);
  // Shorter paths first inside a tier: index pages before deep detail pages.
  const depth = (c: Candidate) => new URL(c.url).pathname.split("/").filter(Boolean).length;
  return [...high.sort((a, b) => depth(a) - depth(b)), ...med, ...low].slice(0, budget);
}

// ---------------------------------------------------------------------------
// Related domains: "clearly the same brand" or ask first
// ---------------------------------------------------------------------------

/** Platforms, CDNs and tools that are never the business's own site. */
const NOT_OWNED = /(^|\.)(facebook|fb|instagram|linkedin|twitter|x|tiktok|youtube|youtu|threads|whatsapp|wa|pinterest|google|goo|gstatic|googleapis|apple|microsoft|bing|wordpress|wix|squarespace|shopify|cloudflare|jsdelivr|unpkg|github|gitlab|medium|substack|vimeo|spotify|amazon|amazonaws|paypal|stripe|calendly|typeform|hubspot|mailchimp|gravatar|w3|schema|creativecommons|linktr|bit|t|tinyurl|zoom|teams|office|live|yahoo|gmail|outlook|trustpilot|glassdoor|crunchbase|wikipedia|maps)\.[a-z.]+$/i;

export function isPlatformHost(host: string): boolean {
  return NOT_OWNED.test(host);
}

export interface SiteSignals {
  host: string;
  brandNames: string[];              // site name, JSON-LD names, workspace name
  socials: string[];                 // normalised profile URLs
  emails: string[];
  phones: string[];                  // digits only
  logoHash: string | null;
  text: string;                      // homepage text (for "a product of X" / copyright)
  linkedFromNav: boolean;            // other site linked from the source's homepage
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (host: string) => host.split(/[.-]/).filter((t) => t.length > 3 && !/^(www|com|org|net|info|group|global|online|site|energy|tech|services?)$/.test(t));

export function emailsIn(text: string): string[] {
  return [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
}

export function phonesIn(text: string): string[] {
  return [...new Set((text.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []).map((p) => p.replace(/\D/g, "")).filter((p) => p.length >= 9 && p.length <= 15))];
}

/**
 * Score how clearly `other` belongs to the same business as `source`.
 * >= 5: crawl automatically. 2-4: ask. < 2: ignore.
 */
export function relationScore(source: SiteSignals, other: SiteSignals): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (other.linkedFromNav) {
    score += 2;
    reasons.push(`linked from ${source.host}`);
  }
  const otherText = norm(other.text);
  const named = source.brandNames.map(norm).filter((n) => n.length >= 4).find((n) => otherText.includes(n));
  if (named) {
    score += 3;
    reasons.push(`${other.host} names "${source.brandNames.find((b) => norm(b) === named) ?? named}"`);
  }
  const sharedSocial = source.socials.find((s) => other.socials.includes(s));
  if (sharedSocial) {
    score += 3;
    reasons.push(`same social profile (${sharedSocial.replace(/^https?:\/\/(www\.)?/, "")})`);
  }
  const srcEmailDomains = new Set([source.host, ...source.emails.map((e) => e.split("@")[1]!)]);
  const sharedContact =
    other.emails.find((e) => srcEmailDomains.has(e.split("@")[1]!)) ??
    other.phones.find((p) => source.phones.some((q) => q.slice(-9) === p.slice(-9)));
  if (sharedContact) {
    score += 2;
    reasons.push("same contact details");
  }
  if (source.logoHash && source.logoHash === other.logoHash) {
    score += 2;
    reasons.push("same logo");
  }
  const theirs = tokens(other.host);
  const shared = tokens(source.host).find((t) => theirs.some((o) => o === t || (Math.min(o.length, t.length) >= 5 && (o.includes(t) || t.includes(o)))));
  if (shared) {
    score += 1;
    reasons.push(`both domains contain "${shared}"`);
  }
  return { score, reasons };
}

export const AUTO_CRAWL = 5;
export const ASK_FIRST = 2;

// ---------------------------------------------------------------------------
// Cleaning: repeated menus and footers are dropped before any token is spent
// ---------------------------------------------------------------------------

/** Lines that appear on more than half of a site's pages (with at least 4 pages) are boilerplate. */
export function stripBoilerplate(pages: string[], threshold = 0.5): string[] {
  if (pages.length < 4) return pages;
  const counts = new Map<string, number>();
  const split = pages.map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean));
  for (const lines of split) for (const l of new Set(lines)) counts.set(l, (counts.get(l) ?? 0) + 1);
  const limit = pages.length * threshold;
  return split.map((lines) => lines.filter((l) => (counts.get(l) ?? 0) <= limit || l.length > 280).join("\n"));
}

/** Rough token count: about 4 characters per token for English text. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const MAX_PAGE_TOKENS = 2_500;

/** Trim a page to the token cap, cutting at a line break. */
export function capText(text: string, maxTokens = MAX_PAGE_TOKENS): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  return text.slice(0, cut > maxChars * 0.6 ? cut : maxChars);
}

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

/** Facts that sites already publish as structured data (no AI needed). */
export function structuredFacts(html: string): { products: { name: string; description?: string; price?: string; url?: string }[]; faqs: { q: string; a: string }[]; services: { name: string; description?: string }[] } {
  const out = { products: [] as { name: string; description?: string; price?: string; url?: string }[], faqs: [] as { q: string; a: string }[], services: [] as { name: string; description?: string }[] };
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    const type = String(o["@type"] ?? "");
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
    if (/^Product$/i.test(type) && str(o.name)) {
      const offer = (Array.isArray(o.offers) ? o.offers[0] : o.offers) as Record<string, unknown> | undefined;
      const price = offer && (str(offer.price) ?? (typeof offer.price === "number" ? String(offer.price) : undefined));
      out.products.push({ name: str(o.name)!, description: str(o.description), price: price ? `${price}${str(offer?.priceCurrency) ? ` ${str(offer?.priceCurrency)}` : ""}` : undefined, url: str(o.url) });
    }
    if (/^Service$/i.test(type) && str(o.name)) out.services.push({ name: str(o.name)!, description: str(o.description) });
    if (/^FAQPage$/i.test(type) && Array.isArray(o.mainEntity)) {
      for (const q of o.mainEntity as Record<string, unknown>[]) {
        const a = q.acceptedAnswer as Record<string, unknown> | undefined;
        if (str(q.name) && a && str(a.text)) out.faqs.push({ q: str(q.name)!, a: str(a.text)!.replace(/<[^>]+>/g, " ").slice(0, 600) });
      }
    }
    for (const k of ["@graph", "hasOfferCatalog", "itemListElement", "makesOffer", "item"]) if (o[k]) walk(o[k]);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]!.trim()));
    } catch { /* malformed JSON-LD is common */ }
  }
  return out;
}
