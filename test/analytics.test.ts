import { describe, expect, it } from "vitest";
import { lengthBucket, postingTimeFeatures, publishFeatures } from "../src/analytics/features.js";
import { snapshotPlan } from "../src/analytics/schedule.js";

const H = 3_600_000;

describe("snapshot schedule", () => {
  it("plans all six offsets for a fresh post", () => {
    const t = new Date("2026-09-01T10:00:00Z");
    const plan = snapshotPlan(t, t);
    expect(plan.map((p) => p.offset)).toEqual(["1h", "6h", "24h", "72h", "7d", "28d"]);
    expect(plan[3]!.dueAt.getTime() - t.getTime()).toBe(72 * H);
  });

  it("takes a slightly late offset now, but never mislabels a far-missed 72h", () => {
    const t = new Date("2026-09-01T00:00:00Z");
    const late = snapshotPlan(t, new Date(t.getTime() + 80 * H)); // 72h is 8h late (< 25%)
    expect(late.find((p) => p.offset === "72h")).toBeDefined();
    expect(late.some((p) => p.offset === "backfill")).toBe(false);

    const veryLate = snapshotPlan(t, new Date(t.getTime() + 5 * 24 * H));
    expect(veryLate.find((p) => p.offset === "72h")).toBeUndefined();
    expect(veryLate.find((p) => p.offset === "backfill")).toBeDefined();
    expect(veryLate.map((p) => p.offset)).toEqual(expect.arrayContaining(["7d", "28d"]));
  });

  it("old history gets a single backfill snapshot", () => {
    const t = new Date("2026-01-01T00:00:00Z");
    expect(snapshotPlan(t, new Date("2026-09-01T00:00:00Z")).map((p) => p.offset)).toEqual(["backfill"]);
  });
});

describe("features", () => {
  it("buckets length", () => {
    expect(lengthBucket(12)).toBe("0-15s");
    expect(lengthBucket(45)).toBe("31-60s");
    expect(lengthBucket(null)).toBeUndefined();
  });

  it("uses the brand's time zone for posting features", () => {
    // 23:30 UTC Monday is 00:30 Tuesday in Lagos (UTC+1)
    expect(postingTimeFeatures(new Date("2026-09-21T23:30:00Z"), "Africa/Lagos")).toEqual({ posting_day: "tue", posting_hour: "00-03" });
  });

  it("freezes idea and brief features at publish time", () => {
    const f = publishFeatures({ hook_type: "price_reveal", pillar: "pricing" }, { format: "reel", cta_type: "share", language: "en-NG" },
      new Date("2026-09-22T10:00:00Z"), 28, "UTC");
    expect(f).toMatchObject({ hook_type: "price_reveal", pillar: "pricing", format: "reel", cta_type: "share", length_bucket: "16-30s", posting_day: "tue", posting_hour: "09-12" });
  });
});
