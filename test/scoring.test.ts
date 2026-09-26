import { describe, expect, it } from "vitest";
import { confidenceLabel, goalFit, opportunityScore, proofFromOutliers, relativeLabel } from "../src/scoring/opportunity.js";
import { outlierRatios } from "../src/competitors/outliers.js";
import { momentumFromSeries, momentumFromTraffic, parseApproxTraffic } from "../src/signals/momentum.js";

describe("opportunity score", () => {
  const c = { L: 0.8, F: 0.9, P: 0.5, M: 0.6, W: 0.7, G: 1 };
  it("follows the weights", () => {
    expect(opportunityScore(c, 10)).toBeCloseTo(100 * (0.3 * 0.8 + 0.25 * 0.9 + 0.15 * 0.5 + 0.1 * 0.6 + 0.1 * 0.7 + 0.1 * 1), 1);
  });
  it("moves L's weight to P during cold start", () => {
    expect(opportunityScore(c, 3)).toBeCloseTo(100 * (0.25 * 0.9 + 0.45 * 0.5 + 0.1 * 0.6 + 0.1 * 0.7 + 0.1 * 1), 1);
    expect(opportunityScore({ ...c, L: null }, 10)).toBe(opportunityScore(c, 3));
  });
  it("labels are relative, never virality", () => {
    const all = [90, 80, 70, 60, 50, 40];
    expect(relativeLabel(90, all)).toBe("top_third");
    expect(relativeLabel(60, all)).toBe("middle_third");
    expect(relativeLabel(40, all)).toBe("bottom_third");
    expect(confidenceLabel(10, 3)).toBe("low");
    expect(confidenceLabel(3, 20)).toBe("medium");
    expect(confidenceLabel(8, 20)).toBe("high");
    // Before the brand has results: outside evidence can reach medium, never high.
    expect(confidenceLabel(0, 0, { sources: 1, proof: 0 })).toBe("low");
    expect(confidenceLabel(0, 0, { sources: 2, proof: 0 })).toBe("medium");
    expect(confidenceLabel(0, 0, { sources: 0, proof: 0.7 })).toBe("medium");
    expect(confidenceLabel(0, 0, { sources: 9, proof: 1 })).toBe("medium");
  });
  it("proof and goal fit", () => {
    expect(proofFromOutliers([])).toBe(0);
    expect(proofFromOutliers([1])).toBe(0);
    expect(proofFromOutliers([5, 2])).toBeCloseTo(1);
    expect(goalFit("engagement", "document_carousel")).toBe(1);
    expect(goalFit("reach", undefined)).toBe(0.5);
  });
});

describe("competitor outliers", () => {
  it("uses views when available and the account median of its last 30 posts", () => {
    const posts = [100, 120, 80, 110, 900].map((v, i) => ({ views: v, likes: 1, comments: 1, published_at: `2026-09-0${i + 1}T00:00:00Z` }));
    const r = outlierRatios(posts);
    expect(r[4]!.outlier_ratio).toBeCloseTo(900 / 110);
    expect(r[0]!.outlier_ratio).toBeCloseTo(100 / 110);
  });
  it("falls back to likes + 2 x comments", () => {
    const posts = [{ likes: 10, comments: 0 }, { likes: 10, comments: 5 }, { likes: 50, comments: 25 }]
      .map((p, i) => ({ ...p, views: null, published_at: `2026-09-0${i + 1}T00:00:00Z` }));
    const r = outlierRatios(posts);
    expect(r[2]!.outlier_ratio).toBeCloseTo(100 / 20);
  });
});

describe("momentum", () => {
  it("rising series score above 0.5, falling below", () => {
    const rising = [...Array(21).fill(100), ...Array(7).fill(300)];
    const falling = [...Array(21).fill(300), ...Array(7).fill(100)];
    expect(momentumFromSeries(rising)!).toBeGreaterThan(0.8);
    expect(momentumFromSeries(falling)!).toBeLessThan(0.3);
    expect(momentumFromSeries([1, 2, 3])).toBeNull();
  });
  it("penalises a topic that already peaked", () => {
    const peaked = [...Array(21).fill(100), 100, 1000, 900, 200, 150, 120, 110];
    const steady = [...Array(21).fill(100), 300, 320, 340, 360, 380, 400, 420];
    expect(momentumFromSeries(peaked)!).toBeLessThan(momentumFromSeries(steady)!);
  });
  it("parses Trends traffic", () => {
    expect(parseApproxTraffic("2,000+")).toBe(2000);
    expect(parseApproxTraffic("200K+")).toBe(200000);
    expect(momentumFromTraffic(1_000_000)).toBeCloseTo(1);
  });
});

describe("money and market", () => {
  it("matches the product an idea sells to the Brand Brain, else brand-building", async () => {
    const { matchOffer } = await import("../src/ideation/precompute.js");
    const offers = [{ name: "Production monitoring platform" }, { name: "Digital readiness assessment" }];
    expect(matchOffer("production monitoring platform", offers)).toBe("Production monitoring platform");
    expect(matchOffer("Free Digital readiness assessment", offers)).toBe("Digital readiness assessment");
    expect(matchOffer("brand", offers)).toBe("brand");
    expect(matchOffer("Something else", offers)).toBe("brand");
    expect(matchOffer(undefined, offers)).toBe("brand");
  });

  it("market items lose momentum with age", async () => {
    const { marketMomentum } = await import("../src/research/market.js");
    const now = new Date("2026-09-26T00:00:00Z");
    expect(marketMomentum(0.9, "2026-09-20", now)).toBe(0.9);
    expect(marketMomentum(0.9, "2026-08-20", now)).toBe(0.72);
    expect(marketMomentum(0.9, "", now)).toBe(0.72);
    expect(marketMomentum(0.9, "2025-01-01", now)).toBe(0.27);
  });
});
