import { describe, expect, it } from "vitest";
import { Brief } from "../src/contracts/brief.js";
import { PublishedPost } from "../src/contracts/stage3.js";
import { sortEvidence } from "../src/contracts/idea.js";
import { platformBrief } from "./fixtures/briefs.js";

describe("brief.v1", () => {
  it("accepts the spec's platform brief", () => {
    expect(Brief.parse(platformBrief).kind).toBe("platform");
  });

  it("a general brief drops platform fields and adds suggested_formats", () => {
    const { platform, format, length_seconds, aspect_ratio, ...rest } = platformBrief;
    const general = { ...rest, kind: "general", messaging: ["Price for time, not just ingredients"], suggested_formats: ["reel", "carousel"] };
    expect(Brief.parse(general).kind).toBe("general");
    expect(() => Brief.parse({ ...general, suggested_formats: [] })).toThrow();
  });

  it("requires exactly 3 hooks and prefixed ids", () => {
    expect(() => Brief.parse({ ...platformBrief, hooks: ["a", "b"] })).toThrow();
    expect(() => Brief.parse({ ...platformBrief, brief_id: "123" })).toThrow();
  });
});

describe("stage 3 contract", () => {
  it("published_post carries brief_id and idea_id", () => {
    const p = PublishedPost.parse({
      platform_post_id: "179", platform: "instagram", workspace_id: "wsp_x", brief_id: "brf_x", idea_id: "ide_x",
      published_at: "2026-09-24T10:00:00+01:00", permalink: "https://instagram.com/p/x",
    });
    expect(p.brief_id).toBe("brf_x");
    expect(() => PublishedPost.parse({ platform_post_id: "1", platform: "myspace", workspace_id: "wsp_x", brief_id: null, idea_id: null, published_at: "x" })).toThrow();
  });
});

describe("evidence order", () => {
  it("own winners first, then comments, competitors, trends", () => {
    const e = sortEvidence([
      { kind: "trend", id: "s", url: null, summary: "" },
      { kind: "competitor_post", id: "c", url: null, summary: "" },
      { kind: "own_post", id: "o", url: null, summary: "" },
    ]);
    expect(e.map((x) => x.kind)).toEqual(["own_post", "competitor_post", "trend"]);
  });
});
