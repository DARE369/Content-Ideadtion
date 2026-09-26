import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brandColorsFrom, extractPage, guessLocale, normalizeColor, pickSubpages, socialFromUrl } from "../src/research/website.js";
import { mergeProfile } from "../src/research/brand.js";
import { renderMigrations } from "../scripts/embed-migrations.js";

const HTML = `<!doctype html><html lang="en"><head>
<title>Lordsway Energy | Digital intelligence for oil &amp; gas</title>
<meta name="description" content="Technology and energy solutions for oil and gas operators across Africa.">
<meta property="og:site_name" content="Lordsway Energy">
<meta name="theme-color" content="#7AC143">
<link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/css/site.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Lordsway Energy Ltd","logo":"https://lordswayenergy.com/logo.png","sameAs":["https://www.linkedin.com/company/lordsway-energy","https://www.instagram.com/lordswayenergy/"]}</script>
<style>.btn{background:#7ac143;color:#fff}.hero{color:#f2c500}.muted{color:#777777}</style>
</head><body>
<img class="site-logo" src="/img/logo-header.png" alt="Lordsway logo">
<nav><a href="/about-us">About</a><a href="/solutions/digital-oilfield">Solutions</a><a href="https://facebook.com/sharer.php?u=x">Share</a>
<a href="https://www.facebook.com/lordswayenergy">Facebook</a><a href="https://twitter.com/intent/tweet">Tweet</a><a href="mailto:hi@x.com">Mail</a></nav>
<h1>Digital intelligence for oil and gas</h1><p>We deliver production monitoring &amp; asset integrity services.</p>
<script>var x = 1;</script></body></html>`;

describe("website extraction", () => {
  const p = extractPage(HTML, "https://lordswayenergy.com/");

  it("reads name, description, language and theme colour", () => {
    expect(p.siteName).toBe("Lordsway Energy");
    expect(p.description).toMatch(/oil and gas operators across Africa/);
    expect(p.lang).toBe("en");
    expect(p.themeColor).toBe("#7AC143");
    expect(p.text).toContain("Digital intelligence for oil and gas");
    expect(p.text).not.toContain("var x");
  });

  it("finds logos in priority order: JSON-LD, <img> logos, touch icon, favicon", () => {
    expect(p.logos[0]).toBe("https://lordswayenergy.com/logo.png");
    expect(p.logos[1]).toBe("https://lordswayenergy.com/img/logo-header.png");
    expect(p.logos).toContain("https://lordswayenergy.com/apple-touch-icon.png");
  });

  it("keeps profile links and drops share buttons", () => {
    expect(p.socials.map((s) => s.platform).sort()).toEqual(["facebook", "instagram", "linkedin"]);
    expect(socialFromUrl("https://twitter.com/intent/tweet")).toBeNull();
    expect(socialFromUrl("https://www.facebook.com/sharer.php?u=x")).toBeNull();
    expect(socialFromUrl("https://www.youtube.com/@lordsway")).toEqual({ platform: "youtube", url: "https://www.youtube.com/@lordsway" });
    expect(socialFromUrl("https://instagram.com")).toBeNull();
  });

  it("picks about / services / product pages on the same site", () => {
    expect(pickSubpages(p)).toEqual(["https://lordswayenergy.com/about-us", "https://lordswayenergy.com/solutions/digital-oilfield"]);
  });

  it("brand colours skip greys and near-duplicates", () => {
    expect(normalizeColor("#abc")).toBe("#aabbcc");
    expect(normalizeColor("rgb(122, 193, 67)")).toBe("#7ac143");
    const c = brandColorsFrom(["#7ac143", "#7AC143", "#7bc244", "#f2c500", "#777777", "#ffffff", "#000000", ...p.inlineColors]);
    expect(c).toEqual(["#7ac143", "#f2c500"]);
  });

  it("locale from <html lang> plus the country domain", () => {
    expect(guessLocale("en", "https://lordsway.com.ng/")).toEqual({ language: "en-NG", country: "NG" });
    expect(guessLocale("en-GB", "https://x.com/")).toEqual({ language: "en-GB", country: "GB" });
    expect(guessLocale(null, "https://x.com/")).toEqual({ language: null, country: null });
  });
});

describe("merging research with the site", () => {
  const site = {
    url: "https://lordswayenergy.com/", reachable: true, name: "Lordsway Energy", description: "From meta", logos: ["https://lordswayenergy.com/logo.png"],
    socials: [{ platform: "linkedin" as const, url: "https://www.linkedin.com/company/lordsway-energy" }],
    cssColors: ["#7ac143"], themeColor: null, language: "en", country: "NG", pages: [],
  };
  const profile = {
    name: "Lordsway Energy", description: "Digital intelligence for oil and gas operators in Africa.", industry: "Oil & gas technology", country: "NG",
    language: "en-NG", audience: "Operations leaders at upstream oil and gas companies", buyer_questions: [" How long does rollout take? ", ""], objections: ["Data security"], pillars: ["Digital oilfield", "Asset integrity"], tone_words: ["expert"],
    products: [
      { name: "Free readiness assessment", description: "", category: "", revenue_role: "lead_magnet" as const, price: "", url: "" },
      { name: "Production monitoring platform", description: "SaaS", category: "Software", revenue_role: "core" as const, price: "", url: "https://lordswayenergy.com/solutions" },
    ],
    social_links: [{ platform: "instagram" as const, url: "https://www.instagram.com/lordswayenergy/" }, { platform: "linkedin" as const, url: "https://linkedin.com/company/lordsway-energy/" }],
    brand_colors: ["#7AC143", "#F2C500", "not-a-colour"], banned_topics: [],
    competitors: [
      { name: "Lordsway itself", website: "lordswayenergy.com", why: "", overlap: [], market: "", confidence: "high" as const, instagram: "", youtube: "", tiktok: "", linkedin: "", facebook: "" },
      { name: "Weak Co", website: "", why: "maybe", overlap: [], market: "NG", confidence: "low" as const, instagram: "@weakco", youtube: "", tiktok: "", linkedin: "", facebook: "" },
      { name: "Strong Co", website: "strongco.com", why: "same platform", overlap: ["Production monitoring platform"], market: "NG", confidence: "high" as const, instagram: "https://instagram.com/strongco/", youtube: "@strongco", tiktok: "not a handle!", linkedin: "", facebook: "" },
    ],
  };
  const m = mergeProfile(site, profile, { website_url: "https://lordswayenergy.com/", goal: "leads" });

  it("core revenue lines first; colours, socials and locale merged and cleaned", () => {
    expect(m.brain.offers.map((o) => o.revenue_role)).toEqual(["core", "lead_magnet"]);
    expect(m.brain.buyer_questions).toEqual(["How long does rollout take?"]);
    expect(m.brain.objections).toEqual(["Data security"]);
    expect(m.brain.offers[0]).toMatchObject({ name: "Production monitoring platform", url: "https://lordswayenergy.com/solutions" });
    expect(m.brain.brand_kit.colors).toEqual(["#7ac143", "#f2c500"]);
    expect(m.brain.brand_kit.logo_url).toBe("https://lordswayenergy.com/logo.png");
    expect(m.brain.social_links.map((s) => s.platform).sort()).toEqual(["instagram", "linkedin"]);
    expect(m.brain.language).toBe("en-NG");
    expect(m.brain.country).toBe("NG");
  });

  it("competitors: drops the brand itself, cleans handles, strongest first", () => {
    expect(m.competitor_suggestions.map((c) => c.name)).toEqual(["Strong Co", "Weak Co"]);
    expect(m.competitor_suggestions[0]).toMatchObject({ website: "https://strongco.com", handles: { instagram: "strongco", youtube: "@strongco" } });
    expect(m.competitor_suggestions[0]!.handles.tiktok).toBeUndefined();
    expect(m.competitor_suggestions[1]!.handles).toEqual({ instagram: "weakco" });
  });
});

describe("embedded migrations", () => {
  it("match supabase/migrations (run npm run migrations:embed if this fails)", () => {
    expect(readFileSync("src/migrations.generated.ts", "utf8")).toBe(renderMigrations());
  });
});
