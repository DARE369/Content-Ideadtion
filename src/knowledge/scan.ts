import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db.js";
import { anthropic, logCost } from "../ai/client.js";
import { config } from "../config.js";
import { newId } from "../lib/ids.js";
import { fetchPage } from "../lib/http.js";
import { PRICES } from "../ai/pricing.js";
import { extractPage, htmlToText, socialFromUrl } from "../research/website.js";
import {
  ASK_FIRST, AUTO_CRAWL, capText, choosePages, classifyPage, canonicalUrl, emailsIn, estimateTokens, hostOf, isAllowed, isPlatformHost,
  parseRobots, parseSitemap, phonesIn, relationScore, sha256, stripBoilerplate, structuredFacts, type Candidate, type Robots, type SiteSignals,
} from "./discover.js";
import { cachedExtractions, chunk, extractInBatch, extractNow, PAGES_PER_REQUEST, PROMPT_VERSION, storeExtraction, splitByUnit, type ExtractUnit } from "./extract.js";
import { ExtractionOutput, markStale, saveCards, type ExtractedCard } from "./cards.js";
import { refreshProductSummaries } from "./products.js";
import { appChunks, appText, looksLikeAppShell, type AppText } from "./apptext.js";

/**
 * A scan runs in three requests, each inside the hosting time limit:
 *   1. preview  - discover, fetch and clean pages (no AI), then show counts and an estimated cost
 *   2. start    - after the user confirms: a real-time quick pass, the rest through the Batch API
 *   3. progress - polled by the page; collects batch results when they are ready
 * Unchanged pages are never downloaded or analysed again.
 */

export const PAGES_PER_SITE = 40;
export const QUICK_PAGES = 9;
export const MAX_RELATED = 5;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 ContentIdeationEngine/0.1";
/** Rough output tokens per page (cards), used for the estimate; replaced by real numbers from the cost log. */
const OUT_TOKENS_PER_PAGE = 600;

export interface SourceRow {
  id: string; workspace_id: string; domain: string; url: string; role: string; added_by: string; status: string;
  relation_score: number | null; relation_reasons: string[]; boilerplate: string[]; last_scanned_at: string | null;
}

interface SnapshotRow {
  id: string; url: string; source_id: string | null; page_type: string; priority: number; status: string; title: string | null;
  etag: string | null; last_modified: string | null; sitemap_lastmod: string | null; content_hash: string | null; text: string | null;
  tokens_est: number; extracted_hash: string | null; extracted_at: string | null; prompt_version: string | null;
}

export interface ScanPreview {
  scan_id: string;
  status: string;
  sources: { id: string; domain: string; role: string; added_by: string; status: string; reasons: string[]; pages: number }[];
  pending_sources: { id: string; domain: string; score: number; reasons: string[] }[];
  pages_found: number;
  pages_by_type: Record<string, number>;
  pages_selected: number;
  pages_to_read: number;
  pages_reused: number;
  unreadable: { url: string; reason: string }[];
  /** Sites built with JavaScript whose words were read from their code instead. */
  app_sites: { domain: string; text_pages: number; covered: number }[];
  est_tokens: number;
  est_cost_usd: number;
  quick_pages: number;
  pages_total: number;
  pages_done: number;
  cards_added: number;
  actual_cost_usd: number | null;
  error: string | null;
}

const deadline = (ms: number) => { const end = Date.now() + ms; return () => end - Date.now(); };

async function pool<T>(items: T[], n: number, left: () => number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && left() > 3_000) await fn(items[i++]!);
  }));
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function listSources(db: Db, ws: string): Promise<SourceRow[]> {
  return (await db.query<SourceRow>("select * from sources where workspace_id = $1 order by status = 'active' desc, created_at", [ws])).rows;
}

export async function addSource(db: Db, ws: string, rawUrl: string, role = "other", addedBy: "user" | "auto" | "confirmed" = "user", status = "active", score: number | null = null, reasons: string[] = []): Promise<SourceRow> {
  const url = canonicalUrl(/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  if (!url) throw new Error("That doesn't look like a website address.");
  const origin = new URL(url).origin;
  const domain = hostOf(url);
  const r = await db.query<SourceRow>(
    `insert into sources (id, workspace_id, domain, url, role, added_by, status, relation_score, relation_reasons)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (workspace_id, domain) do update set
       status = case when sources.status = 'rejected' and excluded.added_by = 'auto' then sources.status
                     when excluded.added_by = 'auto' and sources.status = 'active' then sources.status
                     else excluded.status end,
       role = case when excluded.added_by = 'user' then excluded.role else sources.role end,
       relation_score = coalesce(excluded.relation_score, sources.relation_score),
       relation_reasons = case when cardinality(excluded.relation_reasons) > 0 then excluded.relation_reasons else sources.relation_reasons end
     returning *`,
    [newId("src"), ws, domain, origin, role, addedBy, status, score, reasons],
  );
  return r.rows[0]!;
}

export async function setSourceStatus(db: Db, ws: string, id: string, status: "active" | "rejected"): Promise<void> {
  await db.query(
    `update sources set status = $3, added_by = case when $3 = 'active' and added_by = 'auto' then 'confirmed' else added_by end
     where workspace_id = $1 and id = $2 and role <> 'primary'`,
    [ws, id, status],
  );
}

async function ensurePrimary(db: Db, ws: string): Promise<SourceRow | null> {
  const have = await db.query<SourceRow>("select * from sources where workspace_id = $1 and role = 'primary'", [ws]);
  if (have.rows[0]) return have.rows[0];
  const b = await db.query<{ website_url: string | null }>("select website_url from brand_brains where workspace_id = $1", [ws]);
  const url = b.rows[0]?.website_url;
  return url ? addSource(db, ws, url, "primary") : null;
}

// ---------------------------------------------------------------------------
// Discovery (no AI)
// ---------------------------------------------------------------------------

interface Discovered { source: SourceRow; candidates: Candidate[]; robots: Robots; home: ReturnType<typeof extractPage> | null; homeHtml: string; app: AppText | null }

async function getText(url: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    const r = await fetchPage(url, { timeoutMs, userAgent: BROWSER_UA, maxBytes: 3_000_000 });
    return r.status >= 200 && r.status < 300 ? r.text : null;
  } catch {
    return null;
  }
}

export async function discoverSite(source: SourceRow, left: () => number): Promise<Discovered> {
  const origin = new URL(source.url).origin;
  const host = hostOf(origin);
  const sameSite = (u: string) => hostOf(u) === host;
  const robotsText = await getText(`${origin}/robots.txt`, 6_000);
  const robots = robotsText ? parseRobots(robotsText) : { sitemaps: [], disallow: [], allow: [] };
  const cands: Candidate[] = [];

  // Sitemaps: the site's own list of pages (follow indexes two levels, max 2,000 URLs).
  let queue = robots.sitemaps.length ? robots.sitemaps.slice(0, 4) : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seenMaps = new Set<string>();
  for (let depth = 0; depth < 3 && queue.length && cands.length < 2_000 && left() > 20_000; depth++) {
    const next: string[] = [];
    for (const sm of queue.slice(0, 6)) {
      if (seenMaps.has(sm)) continue;
      seenMaps.add(sm);
      const xml = await getText(sm, 8_000);
      if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;
      const parsed = parseSitemap(xml);
      // Product and service sitemaps first when an index splits them.
      next.push(...parsed.sitemaps.sort((a, b) => Number(/product|service|page/i.test(b)) - Number(/product|service|page/i.test(a))));
      for (const u of parsed.urls) {
        if (!sameSite(u.loc)) continue;
        cands.push({ url: u.loc, lastmod: u.lastmod, ...classifyPage(u.loc) });
        if (cands.length >= 2_000) break;
      }
    }
    queue = next;
  }

  // The homepage: navigation, footer and in-page links.
  let home: ReturnType<typeof extractPage> | null = null;
  let homeHtml = "";
  const html = await getText(source.url, 10_000);
  if (html) {
    homeHtml = html;
    home = extractPage(html, source.url);
    cands.push({ url: source.url, lastmod: null, type: "home", priority: 3 });
    for (const a of home.links) if (sameSite(a.href)) cands.push({ url: a.href, lastmod: null, ...classifyPage(a.href, a.text) });
  }
  // A site built in the browser (React, Vite, Lovable...) sends an empty page: read its words from its own code instead.
  let app: AppText | null = null;
  if (html && home && looksLikeAppShell(html, home.text) && left() > 30_000) {
    app = await appText(source.url, html, { deadlineMs: Math.min(20_000, left() - 25_000) });
    // Links in the code count as homepage links, so a sister site (a product domain) is still found.
    for (const u of app.links) if (!sameSite(u)) home.links.push({ href: u, text: "" });
    if (app.text.length < 100) app = null;
  }
  const allowed = cands.filter((c) => {
    try {
      const u = new URL(c.url);
      return isAllowed(robots, u.pathname + u.search);
    } catch {
      return false;
    }
  });
  return { source, candidates: allowed, robots, home, homeHtml, app };
}

async function logoHash(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000), headers: { "user-agent": BROWSER_UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 && buf.length < 2_000_000 ? sha256(buf) : null;
  } catch {
    return null;
  }
}

function signals(host: string, page: ReturnType<typeof extractPage>, html: string, extraNames: string[], logo: string | null, linkedFromNav: boolean): SiteSignals {
  const text = htmlToText(html);
  return {
    host,
    brandNames: [...new Set([page.siteName, ...page.jsonLdNames, ...extraNames].filter((x): x is string => !!x && x.trim().length >= 3))],
    socials: page.socials.map((s) => s.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")),
    emails: emailsIn(`${text} ${page.links.map((l) => l.href).join(" ")}`),
    phones: phonesIn(text),
    logoHash: logo,
    text,
    linkedFromNav,
  };
}

/**
 * Other domains the homepage links to that might be the same business
 * (a product site, a sister brand). Clear matches are added and crawled; unclear
 * ones wait for the user.
 */
async function relatedDomains(db: Db, ws: string, d: Discovered, workspaceName: string, left: () => number): Promise<SourceRow[]> {
  if (!d.home) return [];
  const counts = new Map<string, { n: number; url: string }>();
  for (const a of d.home.links) {
    const h = hostOf(a.href);
    if (!h || h === d.source.domain || isPlatformHost(h) || socialFromUrl(a.href) || h.endsWith(`.${d.source.domain}`) || d.source.domain.endsWith(`.${h}`)) continue;
    const prev = counts.get(h);
    counts.set(h, { n: (prev?.n ?? 0) + 1, url: prev?.url ?? a.href });
  }
  const existing = new Map((await listSources(db, ws)).map((s) => [s.domain, s]));
  const cands = [...counts.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_RELATED)
    .filter(([h]) => !existing.has(h));
  if (!cands.length) return [];
  const srcSignals = signals(d.source.domain, d.home, d.homeHtml, [workspaceName], await logoHash(d.home.logos[0]), false);
  const added: SourceRow[] = [];
  for (const [h, { url }] of cands) {
    if (left() < 15_000) break;
    const origin = new URL(url).origin;
    const html = await getText(origin, 6_000);
    if (!html) continue;
    const page = extractPage(html, origin);
    const other = signals(h, page, html, [], srcSignals.logoHash ? await logoHash(page.logos[0]) : null, true);
    const { score, reasons } = relationScore(srcSignals, other);
    if (score >= AUTO_CRAWL) added.push(await addSource(db, ws, origin, "product_site", "auto", "active", score, reasons));
    else if (score >= ASK_FIRST) await addSource(db, ws, origin, "other", "auto", "pending_confirm", score, reasons);
  }
  return added;
}

// ---------------------------------------------------------------------------
// Fetch + clean + snapshot (no AI)
// ---------------------------------------------------------------------------

async function snapshotsFor(db: Db, ws: string, urls: string[]): Promise<Map<string, SnapshotRow>> {
  if (!urls.length) return new Map();
  const r = await db.query<SnapshotRow>("select * from page_snapshots where workspace_id = $1 and url = any($2)", [ws, urls]);
  return new Map(r.rows.map((x) => [x.url, x]));
}

interface Fetched { cand: Candidate & { source_id: string }; html: string | null; status: "fresh" | "reused" | "unreadable" | "failed"; etag: string | null; lastModified: string | null; title: string | null; raw: string }

async function fetchCandidate(c: Candidate & { source_id: string }, prev: SnapshotRow | undefined): Promise<Fetched> {
  // The sitemap says it hasn't changed since we last read it: don't even download it.
  if (prev?.content_hash && prev.extracted_at && c.lastmod && Date.parse(c.lastmod) <= Date.parse(prev.extracted_at)) {
    return { cand: c, html: null, status: "reused", etag: prev.etag, lastModified: prev.last_modified, title: prev.title, raw: "" };
  }
  try {
    const r = await fetchPage(c.url, { etag: prev?.etag, lastModified: prev?.last_modified, timeoutMs: 9_000, userAgent: BROWSER_UA, maxBytes: 3_000_000 });
    if (r.status === 304 && prev?.content_hash) return { cand: c, html: null, status: "reused", etag: prev.etag, lastModified: prev.last_modified, title: prev.title, raw: "" };
    if (r.status < 200 || r.status >= 300 || !/html/i.test(r.contentType || "text/html")) return { cand: c, html: null, status: "failed", etag: null, lastModified: null, title: null, raw: "" };
    const page = extractPage(r.text, c.url);
    return { cand: c, html: r.text, status: "fresh", etag: r.etag, lastModified: r.lastModified, title: page.title, raw: page.text };
  } catch {
    return { cand: c, html: null, status: "failed", etag: null, lastModified: null, title: null, raw: "" };
  }
}

async function saveFetched(db: Db, ws: string, source: SourceRow, fetched: Fetched[], prev: Map<string, SnapshotRow>, learn = true): Promise<void> {
  const fresh = learn ? fetched.filter((f) => f.status === "fresh") : [];
  // Lines repeated across most pages are menus and footers: learn them, drop them, remember them.
  const stripped = stripBoilerplate(fresh.map((f) => f.raw));
  let boiler = new Set(source.boilerplate);
  if (fresh.length >= 4) {
    const learned = new Set<string>();
    fresh.forEach((f, i) => {
      const kept = new Set(stripped[i]!.split("\n"));
      for (const l of f.raw.split("\n").map((x) => x.trim()).filter(Boolean)) if (!kept.has(l)) learned.add(l);
    });
    boiler = new Set([...boiler, ...learned]);
    await db.query("update sources set boilerplate = $2 where id = $1", [source.id, [...boiler].slice(0, 600)]);
  }
  for (const f of fetched) {
    const old = prev.get(f.cand.url);
    if (f.status === "reused") {
      await db.query("update page_snapshots set checked_at = now(), sitemap_lastmod = coalesce($3::timestamptz, sitemap_lastmod) where workspace_id = $1 and url = $2",
        [ws, f.cand.url, f.cand.lastmod && !Number.isNaN(Date.parse(f.cand.lastmod)) ? f.cand.lastmod : null]);
      continue;
    }
    if (f.status === "failed") {
      await db.query(
        `insert into page_snapshots (id, workspace_id, source_id, url, page_type, priority, status, checked_at)
         values ($1,$2,$3,$4,$5,$6,'failed', now())
         on conflict (workspace_id, url) do update set checked_at = now(), status = case when page_snapshots.content_hash is null then 'failed' else page_snapshots.status end`,
        [newId("pag"), ws, source.id, f.cand.url, f.cand.type, f.cand.priority],
      );
      continue;
    }
    const base = fresh.length >= 4 && fresh.includes(f) ? stripped[fresh.indexOf(f)]! : f.raw;
    const cleaned = capText(base.split("\n").map((l) => l.trim()).filter((l) => l && !boiler.has(l)).join("\n"));
    const unreadable = cleaned.replace(/\s+/g, " ").length < 80;
    const hash = sha256(cleaned);
    const facts = f.html ? structuredFacts(f.html) : null;
    await db.query(
      `insert into page_snapshots (id, workspace_id, source_id, url, page_type, priority, status, title, etag, last_modified, sitemap_lastmod,
          content_hash, text, tokens_est, structured, fetched_at, checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now())
       on conflict (workspace_id, url) do update set page_type = excluded.page_type, priority = excluded.priority, status = excluded.status,
         title = excluded.title, etag = excluded.etag, last_modified = excluded.last_modified, sitemap_lastmod = excluded.sitemap_lastmod,
         content_hash = excluded.content_hash, text = excluded.text, tokens_est = excluded.tokens_est, structured = excluded.structured,
         fetched_at = now(), checked_at = now(), source_id = excluded.source_id`,
      [old?.id ?? newId("pag"), ws, source.id, f.cand.url, f.cand.type, f.cand.priority, unreadable ? "unreadable" : "fetched", f.title,
        f.etag, f.lastModified, f.cand.lastmod && !Number.isNaN(Date.parse(f.cand.lastmod)) ? f.cand.lastmod : null,
        hash, cleaned, estimateTokens(cleaned), facts && (facts.products.length || facts.faqs.length || facts.services.length) ? JSON.stringify(facts) : null],
    );
    if (old?.content_hash && old.content_hash !== hash && old.id) await markStale(db, ws, old.id);
    if (facts && old?.content_hash !== hash) await structuredCards(db, ws, f.cand.url, facts);
  }
}

/** Products, services and FAQs the site publishes as JSON-LD become cards directly: no AI, no cost. */
async function structuredCards(db: Db, ws: string, url: string, facts: ReturnType<typeof structuredFacts>): Promise<void> {
  const page = (await db.query<{ id: string }>("select id from page_snapshots where workspace_id = $1 and url = $2", [ws, url])).rows[0];
  if (!page) return;
  const cards: ExtractedCard[] = [
    ...facts.products.map((p) => ({ page: 0, type: "product" as const, title: p.name, body: p.description ?? "", attributes: p.price ? [{ key: "price", value: p.price }] : [], product: p.name, quote: p.name, confidence: "high" as const })),
    ...facts.services.map((p) => ({ page: 0, type: "service" as const, title: p.name, body: p.description ?? "", attributes: [], product: p.name, quote: p.name, confidence: "high" as const })),
    ...facts.faqs.map((f) => ({ page: 0, type: "faq" as const, title: f.q, body: f.a, attributes: [], product: "", quote: f.q.slice(0, 200), confidence: "high" as const })),
  ].slice(0, 40);
  await saveCards(db, ws, cards, (c) => ({ kind: "page", ref: page.id, url, quote: c.quote }), { origin: "scan", domain: hostOf(url) });
}

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

/** Haiku list prices; the background share is billed at the 50% batch rate. */
export function estimateCost(quickTokens: number, quickPages: number, batchTokens: number, batchPages: number, fast = config().MODEL_FAST): number {
  const p = PRICES[fast] ?? { input: 1, output: 5 };
  const per = (usd: number) => usd / 1_000_000;
  const quick = quickTokens * 1.15 * per(p.input) + quickPages * OUT_TOKENS_PER_PAGE * per(p.output);
  const batch = (batchTokens * 1.15 * per(p.input) + batchPages * OUT_TOKENS_PER_PAGE * per(p.output)) / 2;
  // Product summaries after the scan: about one short call per 5 pages.
  const summaries = Math.ceil((quickPages + batchPages) / 5) * (1_500 * per(p.input) + 250 * per(p.output));
  return Math.round((quick + batch + summaries) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// 1. Preview
// ---------------------------------------------------------------------------

export async function previewScan(db: Db, ws: string, opts: { extraUrls?: string[]; budgetMs?: number } = {}): Promise<ScanPreview> {
  const left = deadline(opts.budgetMs ?? 50_000);
  const primary = await ensurePrimary(db, ws);
  if (!primary) throw new ScanError("Add your website in the Brand Brain first.");
  for (const u of opts.extraUrls ?? []) if (u.trim()) await addSource(db, ws, u.trim(), "other", "user");
  const wsName = (await db.query<{ name: string }>("select name from workspaces where id = $1", [ws])).rows[0]?.name ?? "";

  const active = (await listSources(db, ws)).filter((s) => s.status === "active");
  const discovered: Discovered[] = [];
  for (const s of active) if (left() > 25_000) discovered.push(await discoverSite(s, left));
  // Related domains are looked for from the primary site only (no chains of chains).
  const primaryD = discovered.find((d) => d.source.role === "primary");
  if (primaryD && left() > 25_000) {
    for (const s of await relatedDomains(db, ws, primaryD, wsName, left)) if (left() > 20_000) discovered.push(await discoverSite(s, left));
  }

  const pagesByType: Record<string, number> = {};
  const chosen: (Candidate & { source_id: string })[] = [];
  let found = 0;
  for (const d of discovered) {
    const uniq = new Set(d.candidates.map((c) => canonicalUrl(c.url)).filter(Boolean));
    found += uniq.size;
    for (const c of choosePages(d.candidates, PAGES_PER_SITE)) chosen.push({ ...c, source_id: d.source.id });
  }
  for (const c of chosen) pagesByType[c.type] = (pagesByType[c.type] ?? 0) + 1;

  const prev = await snapshotsFor(db, ws, chosen.map((c) => c.url));
  const fetched: Fetched[] = [];
  await pool(chosen, 4, left, async (c) => { fetched.push(await fetchCandidate(c, prev.get(c.url))); });
  for (const d of discovered) {
    const mine = fetched.filter((f) => f.cand.source_id === d.source.id);
    await saveFetched(db, ws, d.source, mine, prev);
    await db.query("update sources set last_scanned_at = now() where id = $1", [d.source.id]);
  }
  // Text read from a JavaScript site's code becomes a few "site text" pages (read by the AI like any other page).
  const appUrls: string[] = [];
  for (const d of discovered) {
    if (!d.app) continue;
    const origin = new URL(d.source.url).origin;
    const parts = appChunks(d.app.text);
    const cands = parts.map((_, i) => ({ url: `${origin}/#site-text-${i + 1}`, lastmod: null, type: "home" as const, priority: 3, source_id: d.source.id }));
    const appPrev = await snapshotsFor(db, ws, cands.map((c) => c.url));
    await saveFetched(db, ws, d.source, cands.map((c, i) => ({
      cand: c, html: null, status: "fresh" as const, etag: null, lastModified: null, title: `Site text ${i + 1} of ${parts.length} (read from the site's code)`, raw: parts[i]!,
    })), appPrev, false);
    appUrls.push(...cands.map((c) => c.url));
  }
  // Anything we ran out of time to fetch is queued; "start" fetches it first.
  const fetchedUrls = new Set(fetched.map((f) => f.cand.url));
  for (const c of chosen.filter((x) => !fetchedUrls.has(x.url))) {
    await db.query(
      `insert into page_snapshots (id, workspace_id, source_id, url, page_type, priority, status)
       values ($1,$2,$3,$4,$5,$6,'queued') on conflict (workspace_id, url) do nothing`,
      [newId("pag"), ws, c.source_id, c.url, c.type, c.priority],
    );
  }

  const scanId = newId("scn");
  const snaps = await snapshotsFor(db, ws, [...chosen.map((c) => c.url), ...appUrls]);
  const pageIds = [...chosen.map((c) => c.url), ...appUrls].map((u) => snaps.get(u)?.id).filter((x): x is string => !!x);
  await db.query("insert into scan_runs (id, workspace_id, status, page_ids) values ($1,$2,'preview',$3)", [scanId, ws, pageIds]);
  await refreshEstimate(db, ws, scanId, { found, pagesByType, fetched: fetched.map((f) => f.status) });
  return scanStatus(db, ws, scanId);
}

export class ScanError extends Error {}

/** A "Site text" page: words read from a JavaScript site's code, not a real address. */
export const isSiteText = (url: string) => url.includes("#site-text-");

/** Which selected pages still need the model (text changed, or the prompt did), and the estimate. */
async function refreshEstimate(db: Db, ws: string, scanId: string, extra: { found?: number; pagesByType?: Record<string, number>; fetched?: string[] } = {}): Promise<void> {
  const scan = (await db.query<{ page_ids: string[]; counts: Record<string, unknown> }>("select page_ids, counts from scan_runs where id = $1", [scanId])).rows[0]!;
  const pages = (await db.query<SnapshotRow & { selected: boolean }>("select * from page_snapshots where workspace_id = $1 and id = any($2)", [ws, scan.page_ids])).rows;
  const selected = pages.filter((p) => p.selected && p.status !== "failed" && p.status !== "unreadable");
  const appSources = new Set(pages.filter((p) => isSiteText(p.url) && p.status === "fetched").map((p) => p.source_id ?? ""));
  const needAi = selected.filter((p) => p.status === "queued" || (p.content_hash && (p.extracted_hash !== p.content_hash || p.prompt_version !== PROMPT_VERSION)));
  const cached = await cachedExtractions(db, needAi.map((p) => p.content_hash).filter((h): h is string => !!h));
  const toRead = needAi.filter((p) => !p.content_hash || !cached.has(p.content_hash)).sort((a, b) => b.priority - a.priority);
  const avgTokens = Math.round(selected.filter((p) => p.tokens_est).reduce((s, p) => s + p.tokens_est, 0) / Math.max(1, selected.filter((p) => p.tokens_est).length)) || 1_500;
  const tok = (p: SnapshotRow) => p.tokens_est || avgTokens;
  const quick = toRead.slice(0, QUICK_PAGES);
  const rest = toRead.slice(QUICK_PAGES);
  const estTokens = toRead.reduce((s, p) => s + tok(p), 0);
  const est = estimateCost(quick.reduce((s, p) => s + tok(p), 0), quick.length, rest.reduce((s, p) => s + tok(p), 0), rest.length);
  const counts = {
    ...scan.counts,
    ...(extra.found != null ? { found: extra.found } : {}),
    ...(extra.pagesByType ? { pages_by_type: extra.pagesByType } : {}),
    selected: selected.length,
    to_read: toRead.length,
    reused: selected.length - toRead.length,
    quick: quick.length,
    // Empty pages on a site whose words were read from its code aren't a problem; only real gaps are listed.
    unreadable: pages.filter((p) => p.status === "failed" || (p.status === "unreadable" && !appSources.has(p.source_id ?? "")))
      .map((p) => ({ url: p.url, reason: p.status === "failed" ? "couldn't be downloaded" : "almost no text (the page may need JavaScript)" })),
    app_sites: [...appSources].map((sid) => ({
      source_id: sid,
      text_pages: pages.filter((p) => p.source_id === sid && isSiteText(p.url) && p.status === "fetched").length,
      covered: pages.filter((p) => p.source_id === sid && p.status === "unreadable").length,
    })),
  };
  await db.query("update scan_runs set counts = $2, est_tokens = $3, est_cost_usd = $4, pages_total = $5 where id = $1",
    [scanId, JSON.stringify(counts), estTokens, est, selected.length]);
}

/** Choose pages before starting (default: everything the rules picked). */
export async function selectPages(db: Db, ws: string, scanId: string, pageIds: string[]): Promise<ScanPreview> {
  const scan = (await db.query<{ page_ids: string[] }>("select page_ids from scan_runs where id = $1 and workspace_id = $2 and status = 'preview'", [scanId, ws])).rows[0];
  if (!scan) throw new ScanError("This scan has already started.");
  await db.query("update page_snapshots set selected = (id = any($3)) where workspace_id = $1 and id = any($2)", [ws, scan.page_ids, pageIds]);
  await refreshEstimate(db, ws, scanId);
  return scanStatus(db, ws, scanId);
}

// ---------------------------------------------------------------------------
// 2. Start: quick pass now, the rest in a batch
// ---------------------------------------------------------------------------

export async function startScan(db: Db, ws: string, scanId: string, opts: { budgetMs?: number } = {}): Promise<ScanPreview> {
  const left = deadline(opts.budgetMs ?? 100_000);
  const claimed = await db.query("update scan_runs set status = 'extracting', started_at = now() where id = $1 and workspace_id = $2 and status = 'preview' returning id", [scanId, ws]);
  if (!claimed.rowCount) return scanStatus(db, ws, scanId);
  const scan = (await db.query<{ page_ids: string[] }>("select page_ids from scan_runs where id = $1", [scanId])).rows[0]!;

  // Fetch whatever the preview didn't get to.
  const queued = (await db.query<SnapshotRow>("select * from page_snapshots where workspace_id = $1 and id = any($2) and status = 'queued' and selected", [ws, scan.page_ids])).rows;
  if (queued.length) {
    const sources = new Map((await listSources(db, ws)).map((s) => [s.id, s]));
    const fetched: Fetched[] = [];
    await pool(queued, 4, () => left() - 60_000, async (p) => {
      fetched.push(await fetchCandidate({ url: p.url, type: p.page_type as Candidate["type"], priority: p.priority, lastmod: null, source_id: p.source_id ?? "" }, undefined));
    });
    for (const [sid, source] of sources) await saveFetched(db, ws, source, fetched.filter((f) => f.cand.source_id === sid), new Map());
  }

  const pages = (await db.query<SnapshotRow>(
    `select * from page_snapshots where workspace_id = $1 and id = any($2) and selected and status = 'fetched'
       and (extracted_hash is distinct from content_hash or prompt_version is distinct from $3)
     order by priority desc, tokens_est`,
    [ws, scan.page_ids, PROMPT_VERSION],
  )).rows;

  // Free: pages whose exact text was analysed before (here or in another workspace).
  const cached = await cachedExtractions(db, pages.map((p) => p.content_hash!));
  let added = 0;
  for (const p of pages.filter((x) => cached.has(x.content_hash!))) added += await applyCards(db, ws, p, cached.get(p.content_hash!)!);
  const todo = pages.filter((p) => !cached.has(p.content_hash!));
  const units = (ps: SnapshotRow[]): ExtractUnit[] => ps.map((p) => ({ id: p.id, hash: p.content_hash!, title: p.title, url: p.url, text: p.text }));

  // Quick pass: a person is waiting, so real time, three pages per call, in parallel.
  const quick = todo.slice(0, QUICK_PAGES);
  const quickGroups = chunk(quick, 3);
  const results = await Promise.allSettled(quickGroups.map((g) => extractNow(db, ws, units(g), "knowledge:extract", Math.min(45_000, left() - 25_000))));
  const failedQuick: SnapshotRow[] = [];
  let lastError: unknown = null;
  for (const [i, r] of results.entries()) {
    const group = quickGroups[i]!;
    if (r.status === "fulfilled") for (const [j, p] of group.entries()) added += await applyCards(db, ws, p, r.value[j]!);
    else {
      console.warn(`[scan ${scanId}] quick extraction failed: ${(r.reason as Error)?.message}`);
      lastError = r.reason;
      failedQuick.push(...group);
    }
  }

  // Everything else (and anything the quick pass couldn't do) at the batch discount.
  const rest = [...todo.slice(QUICK_PAGES), ...failedQuick];
  let batchId: string | null = null;
  let groups: Record<string, string[]> = {};
  if (rest.length) {
    try {
      ({ batchId, groups } = await extractInBatch(db, ws, chunk(units(rest), PAGES_PER_REQUEST), `kc:${scanId}`));
    } catch (err) {
      console.warn(`[scan ${scanId}] batch submit failed: ${(err as Error).message}`);
      lastError = err;
    }
  }
  if (rest.length && !batchId) {
    await db.query("update scan_runs set error = $2 where id = $1", [scanId,
      `${rest.length} ${rest.length === 1 ? "page" : "pages"} couldn't be read: ${aiErrorText(lastError)}. Pages already read are saved; scan again to retry the rest (nothing is paid twice).`]);
  }
  await db.query("update scan_runs set batch_id = $2, batch_groups = $3, cards_added = cards_added + $4, pages_done = $5, pages_total = $6 where id = $1",
    [scanId, batchId, JSON.stringify(groups), added, pages.length - rest.length, pages.length]);
  if (!batchId) await finishScan(db, ws, scanId);
  return scanStatus(db, ws, scanId);
}

function aiErrorText(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401) return "the Anthropic API key was rejected";
  if (status === 429) return "the AI service is busy";
  if (err instanceof Error && /budget/i.test(err.message)) return "today's AI budget is used up";
  return "the AI service didn't respond";
}

async function applyCards(db: Db, ws: string, page: SnapshotRow, cards: ExtractedCard[]): Promise<number> {
  const domain = hostOf(page.url);
  const r = await saveCards(db, ws, cards, (c) => ({ kind: "page", ref: page.id, url: page.url, quote: c.quote.slice(0, 240) }), { origin: "scan", domain });
  await db.query("update page_snapshots set extracted_hash = content_hash, extracted_at = now(), prompt_version = $2 where id = $1", [page.id, PROMPT_VERSION]);
  return r.added;
}

// ---------------------------------------------------------------------------
// 3. Progress (polled by the page) and batch results
// ---------------------------------------------------------------------------

/** Batch handler for the job queue fallback (custom id "kc:<scan>:<n>"). */
export async function knowledgeBatchHandler(db: Db, customId: string, output: unknown): Promise<void> {
  const [, scanId] = customId.split(":");
  const scan = (await db.query<{ workspace_id: string; batch_groups: Record<string, string[]> }>("select workspace_id, batch_groups from scan_runs where id = $1", [scanId])).rows[0];
  if (!scan) return;
  const ids = scan.batch_groups[customId] ?? [];
  const pages = (await db.query<SnapshotRow>("select * from page_snapshots where id = any($1)", [ids])).rows;
  const ordered = ids.map((id) => pages.find((p) => p.id === id)).filter((p): p is SnapshotRow => !!p);
  const parsed = ExtractionOutput.safeParse(output);
  if (!parsed.success) return;
  const units: ExtractUnit[] = ordered.map((p) => ({ id: p.id, hash: p.content_hash!, title: p.title, url: p.url, text: p.text }));
  const per = splitByUnit(parsed.data.cards, units);
  let added = 0;
  for (const [i, p] of ordered.entries()) {
    if (p.extracted_hash === p.content_hash && p.prompt_version === PROMPT_VERSION) continue; // already handled
    await storeExtraction(db, p.content_hash!, per[i]!);
    added += await applyCards(db, scan.workspace_id, p, per[i]!);
  }
  await db.query("update scan_runs set cards_added = cards_added + $2, pages_done = pages_done + $3 where id = $1", [scanId, added, ordered.length]);
}

/** Check the batch at most every 15 s while someone is watching; collect results when it has ended. */
export async function pollScan(db: Db, ws: string, scanId: string): Promise<void> {
  const claim = await db.query<{ batch_id: string }>(
    `update scan_runs set checked_at = now() where id = $1 and workspace_id = $2 and status = 'extracting' and batch_id is not null
       and (checked_at is null or checked_at < now() - interval '15 seconds') returning batch_id`,
    [scanId, ws],
  );
  const batchId = claim.rows[0]?.batch_id;
  if (!batchId) return;
  const batch = await anthropic().messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return;
  const groups = (await db.query<{ batch_groups: Record<string, string[]> }>("select batch_groups from scan_runs where id = $1", [scanId])).rows[0]!.batch_groups;
  for await (const r of await anthropic().messages.batches.results(batchId)) {
    if (r.result.type !== "succeeded") continue;
    const msg = r.result.message;
    const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    const pending = await db.query("select 1 from page_snapshots where id = any($1) and (extracted_hash is distinct from content_hash or prompt_version is distinct from $2)",
      [groups[r.custom_id] ?? [], PROMPT_VERSION]);
    if (!pending.rowCount) continue; // the job-queue fallback got here first
    await logCost({ task: "knowledge:extract:batch", workspaceId: ws, db }, msg.model, msg.usage, null, true);
    if (text) await knowledgeBatchHandler(db, r.custom_id, JSON.parse(text));
  }
  await finishScan(db, ws, scanId);
}

export async function finishScan(db: Db, ws: string, scanId: string): Promise<void> {
  const done = await db.query("update scan_runs set status = 'done', finished_at = now() where id = $1 and status = 'extracting' returning id", [scanId]);
  if (!done.rowCount) return;
  await refreshProductSummaries(db, ws).catch((err) => console.warn(`[scan ${scanId}] summaries: ${(err as Error).message}`));
  await db.query(
    `update scan_runs s set actual_cost_usd = coalesce((select sum(cost_usd) from cost_log c
       where c.workspace_id = s.workspace_id and c.task like 'knowledge:%' and c.created_at >= s.started_at), 0)
     where id = $1`,
    [scanId],
  );
}

export async function scanStatus(db: Db, ws: string, scanId: string): Promise<ScanPreview> {
  const s = (await db.query<{
    id: string; status: string; counts: { found?: number; pages_by_type?: Record<string, number>; selected?: number; to_read?: number; reused?: number; quick?: number; unreadable?: { url: string; reason: string }[]; app_sites?: { source_id: string; text_pages: number; covered: number }[] };
    est_tokens: number; est_cost_usd: string; actual_cost_usd: string | null; pages_total: number; pages_done: number; cards_added: number; error: string | null;
  }>("select * from scan_runs where id = $1 and workspace_id = $2", [scanId, ws])).rows[0];
  if (!s) throw new ScanError("Scan not found.");
  const sources = await listSources(db, ws);
  const perSource = (await db.query<{ source_id: string; n: number }>(
    `select source_id, count(*)::int as n from page_snapshots where workspace_id = $1 and url not like '%#site-text-%'
       and id in (select unnest(page_ids) from scan_runs where id = $2) group by 1`, [ws, scanId],
  )).rows;
  return {
    scan_id: s.id, status: s.status,
    sources: sources.filter((x) => x.status === "active").map((x) => ({ id: x.id, domain: x.domain, role: x.role, added_by: x.added_by, status: x.status, reasons: x.relation_reasons, pages: perSource.find((p) => p.source_id === x.id)?.n ?? 0 })),
    pending_sources: sources.filter((x) => x.status === "pending_confirm").map((x) => ({ id: x.id, domain: x.domain, score: x.relation_score ?? 0, reasons: x.relation_reasons })),
    pages_found: s.counts.found ?? 0,
    pages_by_type: s.counts.pages_by_type ?? {},
    pages_selected: s.counts.selected ?? 0,
    pages_to_read: s.counts.to_read ?? 0,
    pages_reused: s.counts.reused ?? 0,
    unreadable: s.counts.unreadable ?? [],
    app_sites: (s.counts.app_sites ?? []).map((a) => ({ domain: sources.find((x) => x.id === a.source_id)?.domain ?? "", text_pages: a.text_pages, covered: a.covered })).filter((a) => a.domain),
    est_tokens: s.est_tokens,
    est_cost_usd: Number(s.est_cost_usd),
    quick_pages: s.counts.quick ?? 0,
    pages_total: s.pages_total,
    pages_done: s.pages_done,
    cards_added: s.cards_added,
    actual_cost_usd: s.actual_cost_usd == null ? null : Number(s.actual_cost_usd),
    error: s.error,
  };
}

/** Drop a preview the user decided not to run (nothing was spent). */
export async function cancelScan(db: Db, ws: string, scanId: string): Promise<void> {
  await db.query("update scan_runs set status = 'cancelled', finished_at = now() where id = $1 and workspace_id = $2 and status = 'preview'", [scanId, ws]);
}

export async function latestScan(db: Db, ws: string): Promise<ScanPreview | null> {
  const r = await db.query<{ id: string }>("select id from scan_runs where workspace_id = $1 order by created_at desc limit 1", [ws]);
  return r.rows[0] ? scanStatus(db, ws, r.rows[0].id) : null;
}

/** Pages chosen for a scan, for "Choose pages". */
export async function scanPages(db: Db, ws: string, scanId: string) {
  return (await db.query(
    `select p.id, p.url, p.page_type, p.priority, p.status, p.selected, p.title, p.tokens_est,
            (p.extracted_hash = p.content_hash and p.prompt_version = $3) as up_to_date
     from page_snapshots p where p.workspace_id = $1 and p.id in (select unnest(page_ids) from scan_runs where id = $2)
     order by p.priority desc, p.url`,
    [ws, scanId, PROMPT_VERSION],
  )).rows;
}
