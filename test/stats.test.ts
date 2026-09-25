import { describe, expect, it } from "vitest";
import { cosine, jaccard, median, normalCdf, percentile, sampleNormal, seededRng } from "../src/lib/stats.js";

describe("stats", () => {
  it("percentile matches Postgres percentile_cont", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(median([])).toBeNull();
  });

  it("normalCdf is accurate", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it("seeded normal samples have the right moments", () => {
    const rng = seededRng(42);
    const xs = Array.from({ length: 20000 }, () => sampleNormal(1, 2, rng));
    const m = xs.reduce((a, b) => a + b) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    expect(m).toBeCloseTo(1, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it("similarity helpers", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(jaccard("Why bakeries lose money", "why BAKERIES lose money!")).toBe(1);
    expect(jaccard("a b", "c d")).toBe(0);
  });
});
