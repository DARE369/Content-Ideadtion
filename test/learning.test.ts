import { describe, expect, it } from "vitest";
import { combine, probBeatsBaseline, shrink, type EstimateIndex } from "../src/learning/model.js";
import { exploreSlots, selectSlots } from "../src/learning/selection.js";
import { floorDecision } from "../src/learning/floor.js";
import { applyGuidance } from "../src/ideation/guidance.js";
import { seededRng } from "../src/lib/stats.js";

const est = (entries: [string, string, number, number, number][], intercept = 0): EstimateIndex => ({
  intercept,
  byKey: new Map(entries.map(([f, v, n, mu, se]) => [`${f}=${v}`, { feature: f, value: v, n, mu_hat: mu, se }])),
});

describe("learning model", () => {
  it("shrinks toward the prior with k = 5", () => {
    expect(shrink(0, 1, 0.2)).toBeCloseTo(0.2);
    expect(shrink(5, 1, 0)).toBeCloseTo(0.5);
    expect(shrink(95, 1, 0)).toBeCloseTo(0.95);
  });

  it("probability of beating the baseline", () => {
    expect(probBeatsBaseline(0, 0.3)).toBeCloseTo(0.5);
    expect(probBeatsBaseline(0.5, 0.2)).toBeGreaterThan(0.99);
    expect(probBeatsBaseline(-0.3, 0.3)).toBeLessThan(0.2);
  });

  it("sums deviations from the brand's intercept; unseen values neither help nor hurt", () => {
    // Every post is a reel, so reel sits at the intercept and adds nothing.
    const e = est([["hook_type", "price_reveal", 3, 0.8, 0.2], ["format", "reel", 9, -0.1, 0.1]], -0.1);
    const c = combine({ hook_type: "price_reveal", format: "reel", visual_style: "new_style" }, e);
    expect(c.mu).toBeCloseTo(0.8);
    expect(c.se).toBeCloseTo(Math.sqrt((0.04 + 0.01) / 2));
    expect(c.evidenceN).toBe(3);
    expect(combine({ visual_style: "new_style" }, e)).toMatchObject({ mu: 0, evidenceN: 0 });
  });
});

describe("explore / exploit", () => {
  const e = est([
    ["hook_type", "price_reveal", 8, 0.9, 0.15],
    ["hook_type", "logo_intro", 6, -0.5, 0.2],
  ]);
  const cands = [
    { id: "a", score: 70, features: { hook_type: "price_reveal" } },
    { id: "b", score: 65, features: { hook_type: "price_reveal" } },
    { id: "c", score: 90, features: { hook_type: "logo_intro" } },
    { id: "d", score: 60, features: { hook_type: "myth_bust" } },
    { id: "e", score: 50, features: { hook_type: "story" } },
  ];

  it("reserves 20% for tests, at least one when there are 3+ slots", () => {
    expect(exploreSlots(5, 0.2)).toBe(1);
    expect(exploreSlots(10, 0.2)).toBe(2);
    expect(exploreSlots(10, 0.1)).toBe(1);
    expect(exploreSlots(2, 0.2)).toBe(0);
  });

  it("exploit slots only take proven combinations", () => {
    const picks = selectSlots(cands, e, 4, 0.25, seededRng(1));
    const exploit = picks.filter((p) => p.slot === "exploit").map((p) => p.item.id);
    expect(exploit).toEqual(["a", "b"]);
    expect(picks.every((p) => p.slot === "explore" ? p.p_beat < 0.7 || !exploit.includes(p.item.id) : p.p_beat >= 0.7)).toBe(true);
    expect(picks).toHaveLength(4);
  });

  it("cold start labels everything as a test and ranks by score", () => {
    const picks = selectSlots(cands, e, 3, 0.2, seededRng(1), true);
    expect(picks.map((p) => p.item.id)).toEqual(["c", "a", "b"]);
    expect(picks.every((p) => p.slot === "explore")).toBe(true);
  });

  it("guidance: prefer with a share swaps in matching ideas; avoid drops exploit picks", () => {
    const picks = selectSlots(cands, e, 3, 0.2, seededRng(2));
    const preferred = applyGuidance(picks, cands, [{ feature: "hook_type", value: "myth_bust", action: "prefer", share: 0.34 }]);
    expect(preferred.some((p) => p.item.id === "d")).toBe(true);
    const avoided = applyGuidance(picks, cands, [{ feature: "hook_type", value: "price_reveal", action: "avoid", share: null }]);
    expect(avoided.filter((p) => p.slot === "exploit" && p.item.features.hook_type === "price_reveal")).toHaveLength(0);
    expect(avoided).toHaveLength(picks.length);
  });
});

describe("floor protection", () => {
  it("drops to 10% after two falling weeks and recovers after two rising weeks", () => {
    expect(floorDecision([1000, 900, 800], 0.2).explore_share).toBe(0.1);
    expect(floorDecision([1000, 900, 950], 0.2).explore_share).toBe(0.2);
    expect(floorDecision([800, 850, 900], 0.1).explore_share).toBe(0.2);
    expect(floorDecision([800, 850, 820], 0.1).explore_share).toBe(0.1);
    expect(floorDecision([800, 700], 0.2).explore_share).toBe(0.2);
  });
});
