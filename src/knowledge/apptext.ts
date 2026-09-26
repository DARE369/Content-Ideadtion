import { fetchPage } from "../lib/http.js";
import { hostOf } from "./discover.js";

/**
 * Many modern sites (React/Vite, Lovable, Next.js, Nuxt) send an empty page and
 * build it in the browser, so a plain fetch finds "almost no text". Their words
 * are still there, for free: in data the page embeds (__NEXT_DATA__, __NUXT__,
 * Next's streamed payloads) and as string literals in the site's own script
 * bundles. We pull out the readable sentences and skip code, CSS classes and
 * library messages. No browser, no paid rendering service.
 */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ContentIdeationEngine/0.1";
export const MAX_SCRIPTS = 4;
const MAX_SCRIPT_BYTES = 6_000_000;
export const MAX_APP_CHARS = 60_000;

/** A page is an empty app shell when there's (almost) no text but there are scripts. */
export function looksLikeAppShell(html: string, visibleText: string): boolean {
  return visibleText.replace(/\s+/g, " ").trim().length < 300 && /<script\b[^>]*\bsrc=/i.test(html);
}

/** Same-site script URLs, most likely to hold page content first. */
export function scriptSources(html: string, baseUrl: string): string[] {
  const host = hostOf(baseUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const u = new URL(m[1]!, baseUrl);
      if (hostOf(u.toString()) !== host) continue;
      if (/(gtag|analytics|gtm|hotjar|clarity|pixel|recaptcha|polyfill|jquery|cookie)/i.test(u.pathname)) continue;
      out.push(u.toString());
    } catch { /* ignore */ }
  }
  // Also modulepreload links (Vite splits routes into chunks).
  for (const m of html.matchAll(/<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1]!, baseUrl);
      if (hostOf(u.toString()) === host) out.push(u.toString());
    } catch { /* ignore */ }
  }
  const score = (u: string) => (/\/(index|main|app|_app|page|pages|layout)[.-]/i.test(u) ? 0 : /vendor|framework|polyfills|webpack|runtime/i.test(u) ? 2 : 1);
  return [...new Set(out)].sort((a, b) => score(a) - score(b));
}

const unescape = (s: string) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, "\n").replace(/\\t/g, " ").replace(/\\(["'`\\/])/g, "$1");

const CODE_WORDS = /\b(function|return|const|let|var|undefined|null|true|false|typeof|instanceof|prototype|webpack|React|props|useState|useEffect|className|onClick|Symbol|Promise|async|await|export|import|require|module|console|window|document|localStorage|JSON|Object|Array|Math|NaN)\b/;
const UTILITY_TOKEN = /^(?:[a-z]+:)*-?[a-z0-9]+(?:-[a-z0-9./[\]%#]+)+$|:/;

/** Is this string human-readable copy (a heading, a sentence), not code or styling? */
export function isProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 12 || t.length > 3_000) return false;
  if (!/^[\p{Lu}\p{N}"'“‘(¿¡]/u.test(t)) return false;            // copy starts like a sentence or a heading
  const words = t.split(/\s+/);
  if (words.length < 3) return false;
  if (/[{}<>;=|\\^~`$]|=>|&&|\|\||%[sdo]\b|\bhttps?:|\.(js|css|png|svg|jpe?g|woff2?)\b|\bpx\b|rgba?\(|var\(--/.test(t)) return false;
  if (CODE_WORDS.test(t)) return false;
  if (/^(Warning|Error|Invariant|Minified|Uncaught|Failed|Cannot|Unexpected|Invalid|Expected)\b/.test(t)) return false;
  if (words.filter((w) => UTILITY_TOKEN.test(w)).length / words.length > 0.3) return false;
  const letters = (t.match(/[\p{L}\s.,'’!?&()%-]/gu) ?? []).length;
  return letters / t.length >= 0.85;
}

/** Readable string literals from a JavaScript bundle, in order, de-duplicated. */
export function proseFromJs(js: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /"((?:[^"\\\n]|\\.){12,3000})"|'((?:[^'\\\n]|\\.){12,3000})'|`((?:[^`\\$]|\\.){12,3000})`/g;
  for (const m of js.matchAll(re)) {
    const s = unescape(m[1] ?? m[2] ?? m[3] ?? "").replace(/\s+/g, " ").trim();
    if (!isProse(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Text a page embeds as data: Next.js (both routers), Nuxt, and <noscript>. */
export function embeddedText(html: string): string[] {
  const chunks: string[] = [];
  const nextData = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (nextData) chunks.push(...stringsInJson(nextData[1]!));
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*"((?:[^"\\]|\\.)*)"\]\)/g)) chunks.push(...proseFromJs(`"${m[1]}"`), ...proseFromJs(unescape(m[1]!)));
  const nuxt = /window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/i.exec(html);
  if (nuxt) chunks.push(...proseFromJs(nuxt[1]!));
  for (const m of html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)) {
    const t = m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (isProse(t)) chunks.push(t);
  }
  return [...new Set(chunks)];
}

function stringsInJson(raw: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (typeof n === "string") {
      const t = n.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (isProse(t)) out.push(t);
    } else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") Object.values(n).forEach(walk);
  };
  try {
    walk(JSON.parse(raw));
  } catch { /* not JSON */ }
  return out;
}

// Hosts that show up in any bundle (library docs, CDNs, standards), never the business's own sites.
const LIBRARY_HOSTS = /(^|\.)(reactjs\.org|react\.dev|github\.com|githubusercontent\.com|w3\.org|schema\.org|mozilla\.org|npmjs\.(com|org)|unpkg\.com|jsdelivr\.net|cloudflare\.com|googleapis\.com|gstatic\.com|google\.com|googletagmanager\.com|google-analytics\.com|sentry\.io|supabase\.(co|com|in)|vercel\.(app|com)|netlify\.(app|com)|lovable\.(app|dev)|tailwindcss\.com|radix-ui\.com|vitejs\.dev|nextjs\.org|vuejs\.org|nuxt\.com|svelte\.dev|mui\.com|fb\.me|example\.(com|org)|localhost|stripe\.com|jquery\.com|fontawesome\.com|openstreetmap\.org|mapbox\.com|leafletjs\.com|lodash\.com|tanstack\.com|zod\.dev|framer\.com|emailjs\.com|typekit\.net|polyfill\.io)$/i;

/** Absolute links inside bundles: other domains the site points to (a product site, socials). */
export function urlsInJs(js: string): string[] {
  const out = new Set<string>();
  for (const raw of js.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'`)<>\\]*)?/gi) ?? []) {
    const u = raw.replace(/[.,;]+$/, "");
    try {
      if (LIBRARY_HOSTS.test(new URL(u).hostname)) continue;
    } catch {
      continue;
    }
    out.add(u);
  }
  return [...out];
}

export interface AppText { text: string; links: string[]; scripts: string[] }

/** Read the site's app code for its words. Best-effort; never throws. */
export async function appText(pageUrl: string, html: string, opts: { deadlineMs?: number } = {}): Promise<AppText> {
  const end = Date.now() + (opts.deadlineMs ?? 20_000);
  const pieces: string[] = [...embeddedText(html)];
  const links = new Set<string>();
  const scripts = scriptSources(html, pageUrl).slice(0, MAX_SCRIPTS);
  for (const src of scripts) {
    if (Date.now() > end - 2_000) break;
    try {
      const r = await fetchPage(src, { timeoutMs: Math.min(10_000, end - Date.now()), userAgent: BROWSER_UA, maxBytes: MAX_SCRIPT_BYTES });
      if (r.status < 200 || r.status >= 300 || !r.text) continue;
      pieces.push(...proseFromJs(r.text));
      for (const u of urlsInJs(r.text)) links.add(u);
    } catch { /* skip this script */ }
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const p of pieces) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (total + p.length > MAX_APP_CHARS) break;
    lines.push(p);
    total += p.length + 1;
  }
  return { text: lines.join("\n"), links: [...links], scripts };
}

/** Split app text into page-sized parts (each under the per-page token cap). */
export function appChunks(text: string, maxChars = 9_000, maxParts = 6): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length + 1 > maxChars) {
      parts.push(cur);
      cur = "";
      if (parts.length >= maxParts) break;
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur && parts.length < maxParts) parts.push(cur);
  return parts.filter((p) => p.length >= 80);
}
