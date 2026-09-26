import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropic } from "../../src/ai/client.js";
import { EXTRACT_ROLE } from "../../src/knowledge/extract.js";
import { previewScan, pollScan, scanStatus, startScan } from "../../src/knowledge/scan.js";
import { coverage } from "../../src/knowledge/cards.js";
import { loadBrain } from "../../src/ideation/context.js";
import { crawlSite } from "../../src/research/website.js";
import { freshDb } from "./setup.js";

/**
 * A whole scan against two local sites: a main site whose sitemap lists its
 * pages, and a product site that names the parent brand (so it's crawled
 * automatically). The model is faked; everything else is real.
 */

const NAV = "Home\nAbout us\nProducts\nServices\nContact\n© 2026 Lordsway Energy. All rights reserved.";
const page = (title: string, body: string, links = "") =>
  `<html lang="en"><head><title>${title}</title></head><body><nav><ul><li>Home</li><li>About us</li><li>Products</li><li>Services</li><li>Contact</li></ul></nav>
   <main><h1>${title}</h1>${body}</main>${links}<footer><p>© 2026 Lordsway Energy. All rights reserved.</p></footer></body></html>`;

let hits: Record<string, number> = {};
let main: Server;
let prod: Server;
let mainUrl = "";
let prodUrl = "";

function serve(routes: (base: string) => Record<string, string>): Promise<[Server, string]> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const base = `http://${req.headers.host}`;
      const body = routes(base)[req.url ?? "/"];
      hits[`${req.headers.host}${req.url}`] = (hits[`${req.headers.host}${req.url}`] ?? 0) + 1;
      if (body == null) {
        res.writeHead(404).end("not found");
        return;
      }
      const etag = `"${Buffer.from(body).length}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304).end();
        return;
      }
      res.writeHead(200, { "content-type": req.url?.endsWith(".js") ? "application/javascript" : req.url?.endsWith(".xml") || req.url === "/robots.txt" ? "text/plain" : "text/html", etag }).end(body);
    }).listen(0, "127.0.0.1", () => resolve([server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`]));
  });
}

// Model fake: one card per source, quoting its first long sentence; batches end immediately.
const calls: string[] = [];
const batches = new Map<string, { custom_id: string; content: Anthropic.ContentBlockParam[] }[]>();
function cardsFor(content: Anthropic.ContentBlockParam[]) {
  const sources: string[] = [];
  for (const b of content) if (b.type === "text" && !b.text.startsWith("### Source") && !b.text.startsWith("Extract the cards")) sources.push(b.text);
  return {
    cards: sources.flatMap((text, i) => {
      const sentence = text.split("\n").find((l) => l.length > 30) ?? "";
      const product = /Well Monitor/.test(text) ? "Well Monitor" : /Readiness Assessment/.test(text) ? "Readiness Assessment" : "";
      return [
        { page: i, type: /Well Monitor|Assessment/.test(sentence) && /^(Well Monitor|Readiness Assessment) is/.test(sentence) ? (product === "Readiness Assessment" ? "service" : "product") : "proof", title: product || "Fact", body: sentence, attributes: [], product, quote: sentence.slice(0, 120), confidence: "high" },
        { page: i, type: "claim", title: "Invented", body: "We are the best in the world", attributes: [], product: "", quote: "nowhere on the page", confidence: "high" },
      ];
    }),
  };
}
const fake = {
  messages: {
    parse: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      const system = (params.system as Anthropic.TextBlockParam[])[0]!.text;
      calls.push(system.startsWith(EXTRACT_ROLE) ? "extract" : "summary");
      const usage = { input_tokens: 3000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const parsed_output = system.startsWith(EXTRACT_ROLE)
        ? cardsFor(params.messages[0]!.content as Anthropic.ContentBlockParam[])
        : { summary: "A monitoring platform.", audience: "Upstream operators", benefits: ["Fewer shutdowns"] };
      return { usage, stop_reason: "end_turn", stop_details: null, parsed_output, content: [] };
    },
    batches: {
      create: async (p: { requests: { custom_id: string; params: { messages: { content: Anthropic.ContentBlockParam[] }[] } }[] }) => {
        const id = `msgbatch_${batches.size + 1}`;
        calls.push("batch");
        batches.set(id, p.requests.map((r) => ({ custom_id: r.custom_id, content: r.params.messages[0]!.content })));
        return { id };
      },
      retrieve: async () => ({ processing_status: "ended" }),
      results: async (id: string) => (async function* () {
        for (const r of batches.get(id) ?? []) {
          yield { custom_id: r.custom_id, result: { type: "succeeded", message: { model: "claude-haiku-4-5", usage: { input_tokens: 4000, output_tokens: 800 }, content: [{ type: "text", text: JSON.stringify(cardsFor(r.content)) }] } } };
        }
      })(),
    },
  },
} as unknown as Anthropic;

let pool: Awaited<ReturnType<typeof freshDb>>["pool"];
let drop: () => Promise<void>;

beforeAll(async () => {
  [prod, prodUrl] = await serve(() => ({
    "/": page("Petrolord", "<p>Petrolord is the software arm of the group: a Lordsway Energy product for field teams across Africa.</p><a href='/products/well-monitor'>Well Monitor</a>"),
    "/products/well-monitor": page("Well Monitor", "<p>Well Monitor is a production monitoring platform that cut unplanned shutdowns by 18% for a Niger Delta operator.</p>"),
  }));
  // The main site links to the product site by hostname "localhost" so it is a different domain.
  [main, mainUrl] = await serve((base) => {
    const prodHost = prodUrl.replace("127.0.0.1", "localhost");
    const subpages: Record<string, string> = {};
    for (let i = 1; i <= 12; i++) subpages[`/services/service-${i}`] = page(`Service ${i}`, `<p>Service ${i} helps upstream operators reduce downtime with field inspection number ${i} and weekly reporting.</p>`);
    return {
      "/robots.txt": `User-agent: *\nDisallow: /private\nSitemap: ${base}/sitemap.xml`,
      "/sitemap.xml": `<urlset>${["/", "/about", "/services/readiness-assessment", "/careers", "/private/plans", ...Object.keys(subpages)].map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`,
      "/": page("Lordsway Energy", "<p>Lordsway Energy brings digital intelligence to oil and gas operations across Africa.</p>", `<a href="${prodHost}/">Petrolord</a><a href="https://www.linkedin.com/company/lordsway">LinkedIn</a>`),
      "/about": page("About", "<p>Founded in Port Harcourt, Lordsway Energy has delivered over 40 digital projects for operators.</p>"),
      "/services/readiness-assessment": page("Readiness Assessment", "<p>Readiness Assessment is a free two-week review of your field's digital gaps, with a written plan at the end.</p>"),
      "/careers": page("Careers", "<p>We are hiring engineers in Lagos and Port Harcourt for our growing field team.</p>"),
      "/private/plans": page("Private", "<p>Secret pricing plans that robots.txt tells us not to read at all.</p>"),
      ...subpages,
    };
  });
  ({ pool, drop } = await freshDb());
  await pool.query("insert into workspaces (id, studio_workspace_id, name) values ('wsp_k', 'wsp_k', 'Lordsway Energy')");
  await pool.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, tone_words, pillars, audience, offers, banned_topics, confirmed_at)
     values ('wsp_k', $1, 'leads', 'en-NG', '{}', '{Digital oilfield}', 'Operators', '[{"name":"Readiness Assessment","revenue_role":"lead_magnet"}]', '{}', now())`,
    [`${mainUrl}/`],
  );
  // The Brand Brain's offers became a product in the migration only for existing rows; create it like the app does.
  await pool.query("insert into products (id, workspace_id, name, revenue_role, origin) values ('prd_ra', 'wsp_k', 'Readiness Assessment', 'lead_magnet', 'brand_brain')");
  setAnthropic(fake);
}, 60_000);

afterAll(async () => {
  main?.close();
  prod?.close();
  await drop?.();
});

describe("knowledge scan", () => {
  let scanId = "";

  it("previews without AI: sitemap pages, robots rules, the product site added automatically, a cost estimate", async () => {
    const p = await previewScan(pool, "wsp_k", { budgetMs: 40_000 });
    scanId = p.scan_id;
    expect(calls).toEqual([]);
    const domains = p.sources.map((s) => s.domain).sort();
    expect(domains).toEqual(["127.0.0.1", "localhost"]);
    const petrolord = p.sources.find((s) => s.domain === "localhost")!;
    expect(petrolord.added_by).toBe("auto");
    expect(petrolord.reasons.join(" ")).toMatch(/names "Lordsway Energy"/);
    expect(hits[`127.0.0.1:${new URL(mainUrl).port}/private/plans`]).toBeUndefined();
    expect(hits[`127.0.0.1:${new URL(mainUrl).port}/careers`]).toBeUndefined();
    expect(p.pages_selected).toBe(17); // 15 main-site pages + 2 on the product site
    expect(p.pages_to_read).toBe(17);
    expect(p.est_cost_usd).toBeGreaterThan(0);
    expect(p.est_cost_usd).toBeLessThan(0.1);
    // Menus and footers are stripped before any token is counted.
    const about = (await pool.query("select text from page_snapshots where url like '%/about'")).rows[0].text as string;
    expect(about).not.toMatch(/All rights reserved/);
    expect(about).toMatch(/40 digital projects/);
  });

  it("starts: a real-time quick pass, the rest in one batch; quotes are checked; products linked or proposed", async () => {
    const s = await startScan(pool, "wsp_k", scanId);
    expect(calls.filter((c) => c === "extract")).toHaveLength(3); // 9 pages, 3 per call
    expect(calls.filter((c) => c === "batch")).toHaveLength(1);
    expect(s.status).toBe("extracting");
    await pollScan(pool, "wsp_k", scanId);
    const done = await scanStatus(pool, "wsp_k", scanId);
    expect(done.status).toBe("done");
    expect(done.pages_done).toBe(17);
    const cards = (await pool.query("select type, title, product_ids, sources from knowledge_cards where workspace_id = 'wsp_k'")).rows;
    expect(cards.some((c) => c.title === "Invented")).toBe(false); // quote not on the page
    expect(cards.every((c) => c.sources[0].quote.length > 10)).toBe(true);
    const wm = (await pool.query("select id, confirmed, origin from products where lower(name) = 'well monitor'")).rows[0];
    expect(wm).toMatchObject({ confirmed: false, origin: "scan" });
    expect(cards.some((c) => c.product_ids.includes("prd_ra"))).toBe(true);
    expect(done.actual_cost_usd).toBeGreaterThan(0);
    // Only confirmed products reach prompts.
    const brain = await loadBrain(pool, "wsp_k");
    expect(brain!.offers.map((o) => o.name)).toEqual(["Readiness Assessment"]);
    const cov = await coverage(pool, "wsp_k");
    expect(cov.find((c) => c.product === "Readiness Assessment")!.items.find((i) => i.key === "pricing")!.question).toMatch(/priced/);
  });

  it("a second scan of unchanged pages downloads nothing new and spends nothing", async () => {
    const before = calls.length;
    const p = await previewScan(pool, "wsp_k", { budgetMs: 40_000 });
    expect(p.pages_to_read).toBe(0);
    expect(p.est_cost_usd).toBe(0);
    await startScan(pool, "wsp_k", p.scan_id);
    expect(calls.length).toBe(before);
    expect((await scanStatus(pool, "wsp_k", p.scan_id)).status).toBe("done");
  });
});

describe("a site built with JavaScript", () => {
  it("reads the words from the site's code when every page is an empty shell", async () => {
    const shell = `<!doctype html><html><head><title>Spa Energy</title><script type="module" src="/assets/index-a1.js"></script></head><body><div id="root"></div></body></html>`;
    const js = `const a="Spa Energy supplies diesel and LPG to factories across Lagos with same-day delivery.",
      b="Our lubricants programme cut engine downtime by a third for a cement plant in Ogun.",
      c="flex items-center gap-2",d="Warning: Each child in a list should have a unique %s prop.";`;
    const [spa, spaUrl] = await serve((base) => ({
      "/sitemap.xml": `<urlset>${["/", "/about", "/services"].map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`,
      "/": shell, "/about": shell, "/services": shell,
      "/assets/index-a1.js": js,
    }));
    try {
      await pool.query("insert into workspaces (id, studio_workspace_id, name) values ('wsp_spa', 'wsp_spa', 'Spa Energy')");
      await pool.query("insert into brand_brains (workspace_id, website_url, goal, language) values ('wsp_spa', $1, 'leads', 'en')", [`${spaUrl}/`]);
      const p = await previewScan(pool, "wsp_spa", { budgetMs: 40_000 });
      expect(p.pages_to_read).toBe(1);
      expect(p.unreadable).toHaveLength(3);
      expect(p.unreadable[0]!.reason).toMatch(/read from the site's code/);
      const text = (await pool.query("select text from page_snapshots where workspace_id = 'wsp_spa' and url like '%#site-text-1'")).rows[0].text as string;
      expect(text).toMatch(/same-day delivery/);
      expect(text).toMatch(/cement plant/);
      expect(text).not.toMatch(/items-center|Warning/);
      // The Brand Brain's website analysis gets the same text.
      const site = await crawlSite(`${spaUrl}/`);
      expect(site.pages.at(-1)!.text).toMatch(/same-day delivery/);
    } finally {
      spa.close();
    }
  });
});
