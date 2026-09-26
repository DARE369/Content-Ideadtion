import { fetchText } from "../lib/http.js";
import type { SocialLink } from "../contracts/brandBrain.js";
import { appText, looksLikeAppShell } from "../knowledge/apptext.js";

/**
 * Reads a brand's website the way a person skimming it would: the homepage plus
 * the about / services / products pages, and the metadata sites publish for
 * search engines and link previews (name, description, logo, social profiles,
 * theme colour). Parsing is pure and unit-tested; fetching is best-effort.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ContentIdeationEngine/0.1";

export interface PageExtract {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  lang: string | null;
  themeColor: string | null;
  logos: string[];
  socials: SocialLink[];
  links: { href: string; text: string }[];
  jsonLdNames: string[];
  jsonLdDescription: string | null;
  text: string;
  inlineColors: string[];
  stylesheets: string[];
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
}

function abs(href: string | null, base: string): string | null {
  if (!href || href.startsWith("data:") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS: [RegExp, SocialLink["platform"]][] = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "facebook"],
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, "x"],
  [/(^|\.)threads\.net$/, "threads"],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, "whatsapp"],
];

/** A profile link, not a share button or a platform's own homepage. */
export function socialFromUrl(url: string): SocialLink | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const hit = SOCIAL_HOSTS.find(([re]) => re.test(host));
  if (!hit) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path || path === "/") return null;
  if (/\/(sharer|share|intent|dialog|plugins|embed|watch|hashtag|explore|p|reel|status|shareArticle)(\/|$|\.php)/i.test(path) && hit[1] !== "whatsapp") return null;
  return { platform: hit[1], url: `https://${u.hostname.replace(/^m\./, "www.")}${path}` };
}

export function dedupeSocials(list: SocialLink[]): SocialLink[] {
  const seen = new Map<string, SocialLink>();
  for (const s of list) {
    const key = s.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/** Normalise #abc / #aabbcc / rgb() to #rrggbb. */
export function normalizeColor(c: string): string | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]!].map((x) => x + x).join("")}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

function hsl(hex: string): { s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

const distance = (a: string, b: string) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return Math.sqrt(pa.reduce((s, v, i) => s + (v - pb[i]!) ** 2, 0));
};

/**
 * Brand colours from CSS: the most frequent saturated colours, ignoring greys,
 * near-white and near-black (those are layout, not brand), and near-duplicates.
 */
export function brandColorsFrom(colors: string[], max = 5): string[] {
  const counts = new Map<string, number>();
  for (const c of colors) {
    const n = normalizeColor(c);
    if (!n) continue;
    const { s, l } = hsl(n);
    if (s < 0.25 || l < 0.08 || l > 0.94) continue;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.every((o) => distance(o, c) > 48)) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export function colorsInCss(css: string): string[] {
  return css.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g) ?? [];
}

function walkJsonLd(node: unknown, out: { names: string[]; logos: string[]; sameAs: string[]; description: string | null }): void {
  if (Array.isArray(node)) return node.forEach((n) => walkJsonLd(n, out));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const type = String(o["@type"] ?? "");
  if (/Organization|Corporation|LocalBusiness|Store|Brand|WebSite|Company/i.test(type)) {
    if (typeof o.name === "string") out.names.push(o.name);
    const logo = o.logo;
    if (typeof logo === "string") out.logos.push(logo);
    else if (logo && typeof logo === "object" && typeof (logo as { url?: unknown }).url === "string") out.logos.push((logo as { url: string }).url);
    if (Array.isArray(o.sameAs)) out.sameAs.push(...o.sameAs.filter((x): x is string => typeof x === "string"));
    if (!out.description && typeof o.description === "string") out.description = o.description;
  }
  if (o["@graph"]) walkJsonLd(o["@graph"], out);
}

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

export function extractPage(html: string, url: string): PageExtract {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key: string) => {
    for (const m of metas) {
      const k = (attr(m, "property") ?? attr(m, "name") ?? "").toLowerCase();
      if (k === key) return attr(m, "content");
    }
    return null;
  };
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const icons: { href: string; score: number }[] = [];
  const stylesheets: string[] = [];
  for (const l of links) {
    const rel = (attr(l, "rel") ?? "").toLowerCase();
    const href = abs(attr(l, "href"), url);
    if (!href) continue;
    if (rel.includes("stylesheet")) stylesheets.push(href);
    if (rel.includes("apple-touch-icon")) icons.push({ href, score: 3 });
    else if (rel.includes("icon")) icons.push({ href, score: /\.svg|\.png/i.test(href) ? 2 : 1 });
  }
  const ld = { names: [] as string[], logos: [] as string[], sameAs: [] as string[], description: null as string | null };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkJsonLd(JSON.parse(m[1]!.trim()), ld);
    } catch { /* malformed JSON-LD is common; skip it */ }
  }
  // <img> tags whose class/alt/src says "logo" are the most reliable logo on many sites.
  const imgLogos: string[] = [];
  for (const m of html.match(/<img\b[^>]*>/gi) ?? []) {
    const hay = `${attr(m, "class") ?? ""} ${attr(m, "alt") ?? ""} ${attr(m, "src") ?? ""} ${attr(m, "id") ?? ""}`;
    if (/logo/i.test(hay)) {
      const src = abs(attr(m, "src") ?? attr(m, "data-src"), url);
      if (src) imgLogos.push(src);
    }
  }
  const anchors: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = abs(attr(`<a ${m[1]}>`, "href"), url);
    if (href) anchors.push({ href, text: htmlToText(m[2]!).slice(0, 80) });
  }
  const socials = dedupeSocials(
    [...ld.sameAs, ...anchors.map((a) => a.href)].map(socialFromUrl).filter((s): s is SocialLink => !!s),
  );
  const ogImage = abs(meta("og:image"), url);
  const logos = [...new Set([
    ...ld.logos.map((l) => abs(l, url)).filter((x): x is string => !!x),
    ...imgLogos,
    ...icons.sort((a, b) => b.score - a.score).map((i) => i.href),
    ...(ogImage ? [ogImage] : []),
  ])];
  const inline = [
    ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].flatMap((m) => colorsInCss(m[1]!)),
    ...[...html.matchAll(/style=["']([^"']*)["']/gi)].flatMap((m) => colorsInCss(m[1]!)),
  ];
  const langM = /<html[^>]*\blang=["']?([a-zA-Z-]+)/i.exec(html);
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return {
    url,
    title: titleM ? decode(titleM[1]!).trim() : null,
    siteName: meta("og:site_name") ?? ld.names[0] ?? null,
    description: meta("description") ?? meta("og:description") ?? ld.description,
    lang: langM ? langM[1]! : null,
    themeColor: meta("theme-color"),
    logos,
    socials,
    links: anchors,
    jsonLdNames: ld.names,
    jsonLdDescription: ld.description,
    text: htmlToText(html),
    inlineColors: inline,
    stylesheets,
  };
}

const SUBPAGE = /about|who-we-are|company|service|product|solution|what-we-do|offer|pricing|price|shop|store|portfolio|industr|capabilit|menu|packages/i;

/** Same-site pages worth reading: about, services, products, pricing. */
export function pickSubpages(page: PageExtract, max = 4): string[] {
  const base = new URL(page.url);
  const out: string[] = [];
  for (const a of page.links) {
    let u: URL;
    try {
      u = new URL(a.href);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|jpg|png|zip|docx?)$/i.test(u.pathname)) continue;
    if (!SUBPAGE.test(u.pathname) && !SUBPAGE.test(a.text)) continue;
    u.hash = "";
    const s = u.toString();
    if (s !== page.url && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const TLD_COUNTRY: Record<string, string> = {
  ng: "NG", gh: "GH", ke: "KE", za: "ZA", uk: "GB", in: "IN", ca: "CA", au: "AU", nz: "NZ", ie: "IE",
  fr: "FR", de: "DE", es: "ES", it: "IT", br: "BR", mx: "MX", eg: "EG", ae: "AE", sa: "SA", tz: "TZ", ug: "UG", rw: "RW",
};

/** Language + locale from <html lang> and the country domain, e.g. en + .ng -> en-NG. */
export function guessLocale(lang: string | null, url: string): { language: string | null; country: string | null } {
  let country: string | null = null;
  try {
    const tld = new URL(url).hostname.split(".").pop() ?? "";
    country = TLD_COUNTRY[tld] ?? null;
  } catch { /* ignore */ }
  const l = lang?.split("-")[0]?.toLowerCase() ?? null;
  const region = lang?.split("-")[1]?.toUpperCase() ?? null;
  const c = country ?? region;
  return { language: l ? (c ? `${l}-${c}` : l) : null, country: c };
}

export interface SiteProfile {
  url: string;
  reachable: boolean;
  name: string | null;
  description: string | null;
  logos: string[];
  socials: SocialLink[];
  cssColors: string[];
  themeColor: string | null;
  language: string | null;
  country: string | null;
  pages: { url: string; title: string | null; text: string }[];
}

async function get(url: string, timeoutMs = 12_000, maxRetries = 1): Promise<string> {
  return fetchText(url, { headers: { "user-agent": BROWSER_UA, accept: "text/html,*/*" }, limitKey: "websites", maxRetries, timeoutMs, maxBackoffMs: 3_000 });
}

/** Worst case about 35 s: the homepage (one retry), then sub-pages and stylesheets together. */

export async function crawlSite(url: string): Promise<SiteProfile> {
  const empty: SiteProfile = { url, reachable: false, name: null, description: null, logos: [], socials: [], cssColors: [], themeColor: null, language: null, country: null, pages: [] };
  let home: PageExtract;
  let homeHtml = "";
  try {
    homeHtml = await get(url);
    home = extractPage(homeHtml, url);
  } catch {
    return { ...empty, ...guessLocale(null, url) };
  }
  const subUrls = pickSubpages(home);
  // Up to two same-site stylesheets for brand colours.
  const host = new URL(url).hostname.replace(/^www\./, "");
  const sheets = home.stylesheets.filter((s) => new URL(s).hostname.replace(/^www\./, "").endsWith(host)).slice(0, 2);
  const [subPages, sheetTexts] = await Promise.all([
    Promise.all(subUrls.map(async (u) => {
      try {
        return extractPage(await get(u, 8_000, 0), u);
      } catch {
        return null;
      }
    })),
    Promise.all(sheets.map((s) => get(s, 8_000, 0).then((t) => t.slice(0, 400_000)).catch(() => ""))),
  ]);
  const subs = subPages.filter((x): x is PageExtract => !!x);
  // A site built in the browser sends empty pages: read its words from its own code (free, no browser).
  let appPage: { url: string; title: string | null; text: string } | null = null;
  if (looksLikeAppShell(homeHtml, home.text)) {
    const app = await appText(url, homeHtml, { deadlineMs: 15_000 }).catch(() => null);
    if (app && app.text.length >= 100) {
      appPage = { url, title: "Site text (read from the site's code)", text: app.text.slice(0, 12_000) };
      home.socials.push(...app.links.map(socialFromUrl).filter((x): x is SocialLink => !!x));
    }
  }
  const css = sheetTexts.join("\n");
  const cssColors = brandColorsFrom([...(home.themeColor ? [home.themeColor, home.themeColor, home.themeColor] : []), ...home.inlineColors, ...colorsInCss(css)]);
  const all = [home, ...subs];
  const name = home.siteName ?? home.jsonLdNames[0] ?? home.title?.split(/\s[|\-–—:]\s/)[0]?.trim() ?? null;
  return {
    url,
    reachable: true,
    name,
    description: home.description ?? home.jsonLdDescription,
    logos: [...new Set(all.flatMap((p) => p.logos))].slice(0, 6),
    socials: dedupeSocials(all.flatMap((p) => p.socials)),
    cssColors,
    themeColor: home.themeColor ? normalizeColor(home.themeColor) : null,
    ...guessLocale(home.lang, url),
    pages: [...all.map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, 7000) })), ...(appPage ? [appPage] : [])],
  };
}
