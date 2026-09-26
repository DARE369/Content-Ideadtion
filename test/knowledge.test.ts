import { describe, expect, it } from "vitest";
import {
  capText, choosePages, classifyPage, isAllowed, parseRobots, parseSitemap, relationScore, stripBoilerplate, structuredFacts,
  type SiteSignals,
} from "../src/knowledge/discover.js";
import { matchProduct, quoteInSource, validCards, type ExtractedCard } from "../src/knowledge/cards.js";
import { estimateCost } from "../src/knowledge/scan.js";

describe("robots.txt and sitemaps", () => {
  const robots = parseRobots(`
User-agent: Googlebot
Disallow: /nothing-for-us

User-agent: *
Disallow: /admin
Disallow: /*.pdf$
Allow: /admin/public

Sitemap: https://ex.com/sitemap_index.xml
`);
  it("reads rules for * and every sitemap line", () => {
    expect(robots.sitemaps).toEqual(["https://ex.com/sitemap_index.xml"]);
    expect(robots.disallow).toEqual(["/admin", "/*.pdf$"]);
  });
  it("longest match wins, allow wins ties", () => {
    expect(isAllowed(robots, "/admin/settings")).toBe(false);
    expect(isAllowed(robots, "/admin/public/page")).toBe(true);
    expect(isAllowed(robots, "/files/brochure.pdf")).toBe(false);
    expect(isAllowed(robots, "/nothing-for-us")).toBe(true);
    expect(isAllowed(robots, "/products")).toBe(true);
  });
  it("parses sitemap indexes and url sets", () => {
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://ex.com/page-sitemap.xml</loc></sitemap></sitemapindex>`).sitemaps)
      .toEqual(["https://ex.com/page-sitemap.xml"]);
    const set = parseSitemap(`<urlset><url><loc><![CDATA[https://ex.com/services/a?x=1&amp;y=2]]></loc><lastmod>2026-09-01</lastmod></url></urlset>`);
    expect(set.urls).toEqual([{ loc: "https://ex.com/services/a?x=1&y=2", lastmod: "2026-09-01" }]);
  });
});

describe("page sorting and choosing", () => {
  it("sorts pages by what they describe", () => {
    expect(classifyPage("https://ex.com/").type).toBe("home");
    expect(classifyPage("https://ex.com/solutions/digital-oilfield").type).toBe("solution");
    expect(classifyPage("https://ex.com/our-services").type).toBe("service");
    expect(classifyPage("https://ex.com/case-studies/delta").type).toBe("case_study");
    expect(classifyPage("https://ex.com/pricing").type).toBe("pricing");
    expect(classifyPage("https://ex.com/careers/engineer").priority).toBe(0);
    expect(classifyPage("https://ex.com/privacy-policy").priority).toBe(0);
    expect(classifyPage("https://ex.com/brochure.pdf").priority).toBe(0);
    expect(classifyPage("https://ex.com/xyz", "Our Products").type).toBe("product");
  });
  it("high value first, then medium, then only the newest blog posts, within budget", () => {
    const c = (url: string, lastmod: string | null = null) => ({ url, lastmod, ...classifyPage(url) });
    const picked = choosePages([
      c("https://ex.com/blog/old", "2024-01-01"), c("https://ex.com/blog/new", "2026-09-01"), c("https://ex.com/about"),
      c("https://ex.com/products/a/"), c("https://ex.com/products/a#top"), c("https://ex.com/products"), c("https://ex.com/careers"),
    ], 4, 1);
    expect(picked.map((p) => p.url)).toEqual(["https://ex.com/products", "https://ex.com/products/a", "https://ex.com/about", "https://ex.com/blog/new"]);
  });
});

describe("related domains", () => {
  const base: SiteSignals = { host: "lordswayenergy.com", brandNames: ["Lordsway Energy"], socials: ["linkedin.com/company/lordsway"], emails: ["info@lordswayenergy.com"], phones: ["2348031234567"], logoHash: "abc", text: "", linkedFromNav: false };
  it("a product site that names the parent brand is clearly the same business", () => {
    const petrolord: SiteSignals = { host: "petrolord.com", brandNames: ["Petrolord"], socials: [], emails: [], phones: [], logoHash: null, text: "© 2026 Petrolord, a Lordsway Energy product", linkedFromNav: true };
    const r = relationScore(base, petrolord);
    expect(r.score).toBeGreaterThanOrEqual(5);
    expect(r.reasons.join(" ")).toMatch(/names "Lordsway Energy"/);
  });
  it("a partner linked from the homepage only is a question, not a crawl", () => {
    const partner: SiteSignals = { host: "someoem.com", brandNames: ["Some OEM"], socials: [], emails: [], phones: [], logoHash: null, text: "Industrial valves", linkedFromNav: true };
    expect(relationScore(base, partner).score).toBe(2);
  });
  it("shared contact details and social profiles count", () => {
    const sister: SiteSignals = { host: "lordsway-academy.org", brandNames: [], socials: ["linkedin.com/company/lordsway"], emails: ["hello@lordswayenergy.com"], phones: [], logoHash: "abc", text: "", linkedFromNav: false };
    expect(relationScore(base, sister).score).toBe(3 + 2 + 2 + 1);
  });
});

describe("cleaning and structured data", () => {
  it("drops lines repeated on most pages (menus, footers)", () => {
    const pages = ["Home\nAbout\nWe sell pumps\n© Co", "Home\nAbout\nPricing is on request\n© Co", "Home\nAbout\nCase study: Delta field\n© Co", "Home\nAbout\nFAQ\n© Co"];
    expect(stripBoilerplate(pages)).toEqual(["We sell pumps", "Pricing is on request", "Case study: Delta field", "FAQ"]);
  });
  it("caps long pages at a line break", () => {
    const t = capText("a".repeat(30) + "\n" + "b".repeat(40), 12);
    expect(t).toBe("a".repeat(30));
  });
  it("reads products, services and FAQs from JSON-LD without AI", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Well Monitor","offers":{"price":"1200","priceCurrency":"USD"}},
      {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How long is setup?","acceptedAnswer":{"@type":"Answer","text":"<p>Two weeks.</p>"}}]}]}</script>`;
    const f = structuredFacts(html);
    expect(f.products).toEqual([{ name: "Well Monitor", description: undefined, price: "1200 USD", url: undefined }]);
    expect(f.faqs[0]!.q).toBe("How long is setup?");
    expect(f.faqs[0]!.a.trim()).toBe("Two weeks.");
  });
});

describe("knowledge cards", () => {
  const card = (over: Partial<ExtractedCard>): ExtractedCard => ({ page: 0, type: "proof", title: "Uptime", body: "99.5% uptime", attributes: [], product: "", quote: "99.5% uptime across 40 wells", confidence: "high", ...over });
  it("keeps only facts whose quote really is in the source", () => {
    const text = "Our platform delivered 99.5% uptime across 40 wells in 2025.";
    expect(quoteInSource("99.5% uptime across 40 wells", text)).toBe(true);
    expect(quoteInSource("100% uptime guaranteed", text)).toBe(false);
    const ok = validCards([card({}), card({ quote: "invented claim" }), card({})], [text]);
    expect(ok).toHaveLength(1);
  });
  it("image sources can't be checked, so they are never high confidence", () => {
    expect(validCards([card({})], [null])[0]!.confidence).toBe("medium");
  });
  it("matches product names loosely", () => {
    const ps = [{ id: "p1", name: "Production Monitoring Platform" }, { id: "p2", name: "Digital readiness assessment" }];
    expect(matchProduct("production monitoring platform", ps)?.id).toBe("p1");
    expect(matchProduct("The Digital Readiness Assessment (free)", ps)?.id).toBe("p2");
    expect(matchProduct("Drilling", ps)).toBeNull();
  });
});

describe("scan cost estimate", () => {
  it("a 40-page site costs cents, with the background share at the batch rate", () => {
    const est = estimateCost(9 * 2_000, 9, 31 * 2_000, 31, "claude-haiku-4-5");
    expect(est).toBeGreaterThan(0.05);
    expect(est).toBeLessThan(0.25);
    expect(estimateCost(0, 0, 0, 0, "claude-haiku-4-5")).toBe(0);
  });
});
