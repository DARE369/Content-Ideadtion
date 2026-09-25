import { describe, expect, it } from "vitest";
import { withUtm } from "../src/handoff/utm.js";
import { postSigned, sign, verify } from "../src/handoff/webhook.js";
import { exportBrief, exportIdeas } from "../src/ideation/export.js";
import { Brief } from "../src/contracts/brief.js";
import { platformBrief } from "./fixtures/briefs.js";

describe("utm", () => {
  it("tags CTA links with the brief id", () => {
    const u = new URL(withUtm("https://shop.example/cakes?x=1", { platform: "tiktok", briefId: "brf_1", ideaId: "ide_1" }));
    expect(u.searchParams.get("utm_campaign")).toBe("brf_1");
    expect(u.searchParams.get("utm_source")).toBe("tiktok");
    expect(u.searchParams.get("x")).toBe("1");
  });
});

describe("signed webhook", () => {
  it("signs and verifies, rejecting tampering and stale timestamps", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign("s3cret", ts, '{"a":1}');
    expect(verify("s3cret", ts, '{"a":1}', sig)).toBe(true);
    expect(verify("s3cret", ts, '{"a":2}', sig)).toBe(false);
    expect(verify("other", ts, '{"a":1}', sig)).toBe(false);
    expect(verify("s3cret", ts, '{"a":1}', sig, Date.now() + 10 * 60_000)).toBe(false);
  });

  it("sends the idempotency key and signature headers", async () => {
    let seen: Headers | undefined;
    const fake = (async (_url: string, init: RequestInit) => {
      seen = new Headers(init.headers);
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    await postSigned("https://studio.example/hook", "k", "brf_1", { a: 1 }, fake);
    expect(seen!.get("x-idempotency-key")).toBe("brf_1");
    expect(seen!.get("x-signature")).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe("export formats", () => {
  const card = {
    idea_id: "ide_1", title: "Price reveal", why_now: "Your audience keeps asking", core_idea: "…", platform: "instagram",
    evidence: [{ kind: "own_post" as const, id: "pst_1", url: null, summary: "did 2.4× baseline" }], score: 71, relative: "top_third" as const,
    confidence: "medium" as const, content_type: "reel", effort: "low" as const, risks: ["pricing, sensitive"], label: "proven" as const, features: {},
  };
  it("markdown, csv and json", () => {
    expect(exportIdeas([card], "md")).toContain("Proven pattern · likely top third");
    const csv = exportIdeas([card], "csv").split("\n");
    expect(csv[0]).toContain("idea_id,title");
    expect(csv[1]).toContain('"pricing, sensitive"');
    expect(JSON.parse(exportIdeas([card], "json"))[0].idea_id).toBe("ide_1");
    const md = exportBrief(Brief.parse(platformBrief), "md");
    expect(md).toContain("instagram · reel · 9:16 · 20-35s");
    expect(md).toContain("| 0-2s | hook |");
  });
});
