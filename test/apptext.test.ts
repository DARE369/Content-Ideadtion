import { describe, expect, it } from "vitest";
import { appChunks, embeddedText, isProse, looksLikeAppShell, proseFromJs, scriptSources, urlsInJs } from "../src/knowledge/apptext.js";

const SHELL = `<!doctype html><html><head><title>Lordsway</title>
<script type="module" crossorigin src="/assets/index-Bx12.js"></script>
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<link rel="modulepreload" href="/assets/vendor-99.js"></head><body><div id="root"></div></body></html>`;

const BUNDLE = `var e="Warning: Each child in a list should have a unique %s prop.";
const t=r.jsx("h1",{className:"text-4xl font-bold tracking-tight",children:"Integrated energy services for West Africa"}),
n=r.jsx("p",{children:"We supply diesel, LPG and lubricants to industrial clients across Nigeria, with 24/7 delivery."}),
o="flex items-center justify-between gap-4 px-6 py-3",u='Petrolord Suite helps upstream teams plan wells faster.',
l="https://petrolord.com/suite",m="https://reactjs.org/docs/error-decoder.html",z="Cannot read properties of undefined (reading 'map')",
q=\`Request a quote today and get a reply within one working day.\`,s="application/json",w="useEffect must not return anything besides a function";`;

describe("reading JavaScript-built sites", () => {
  it("spots an empty app shell", () => {
    expect(looksLikeAppShell(SHELL, "")).toBe(true);
    expect(looksLikeAppShell("<p>" + "Real words here. ".repeat(40) + "</p>", "Real words here. ".repeat(40))).toBe(false);
  });

  it("lists same-site scripts, app code first, trackers skipped", () => {
    expect(scriptSources(SHELL, "https://lordswayenergy.com/")).toEqual([
      "https://lordswayenergy.com/assets/index-Bx12.js",
      "https://lordswayenergy.com/assets/vendor-99.js",
    ]);
  });

  it("keeps the copy and drops code, class names and library messages", () => {
    const prose = proseFromJs(BUNDLE);
    expect(prose).toEqual([
      "Integrated energy services for West Africa",
      "We supply diesel, LPG and lubricants to industrial clients across Nigeria, with 24/7 delivery.",
      "Petrolord Suite helps upstream teams plan wells faster.",
      "Request a quote today and get a reply within one working day.",
    ]);
    expect(isProse("flex items-center justify-between gap-4")).toBe(false);
  });

  it("finds the site's own outside links, not library ones", () => {
    expect(urlsInJs(BUNDLE)).toEqual(["https://petrolord.com/suite"]);
  });

  it("reads Next.js page data", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { hero: "<p>Drilling fluids delivered to your rig in 48 hours.</p>", slug: "home-page" } } })}</script>`;
    expect(embeddedText(html)).toEqual(["Drilling fluids delivered to your rig in 48 hours."]);
  });

  it("splits long text into page-sized parts", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} about our energy services and products.`).join("\n");
    const parts = appChunks(text, 2_000);
    expect(parts.length).toBe(6);
    expect(parts.every((p) => p.length <= 2_000)).toBe(true);
  });
});
