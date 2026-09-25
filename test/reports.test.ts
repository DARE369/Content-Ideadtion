import { describe, expect, it } from "vitest";
import { featureTable, keepCited, weeklyTables, type ReportPost } from "../src/reports/tables.js";
import { scoreCandidates } from "../src/matching/external.js";
import { isQuestion } from "../src/signals/questions.js";
import { htmlToText } from "../src/ideation/brandBrain.js";

const post = (id: string, pi: number | null, hook: string, day: number, label: "proven" | "test" = "proven"): ReportPost => ({
  post_id: id, platform: "instagram", published_at: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`,
  views: pi == null ? null : pi * 1000, pi, goal_index: null, comments: 3, label, features: { hook_type: hook, format: "reel", language: "en" },
});

describe("report tables", () => {
  const posts = [post("p1", 2.6, "price_reveal", 10), post("p2", 2.2, "price_reveal", 17), post("p3", 0.6, "logo", 18, "test"),
    post("p4", 0.6, "logo", 19, "test"), post("p5", 2.4, "price_reveal", 20)];

  it("feature table: 3 price reveals averaged 2.4x, 2 logo openers 0.6x", () => {
    const rows = featureTable(posts);
    const pr = rows.find((r) => r.value === "price_reveal")!;
    const logo = rows.find((r) => r.value === "logo")!;
    expect(pr).toMatchObject({ n: 3, mean_pi: 2.4, post_ids: ["p1", "p2", "p5"] });
    expect(logo).toMatchObject({ n: 2, mean_pi: 0.6 });
    expect(rows.some((r) => r.feature === "language")).toBe(false);
  });

  it("weekly platform summary", () => {
    const t = weeklyTables({ start: new Date("2026-09-15T00:00:00Z"), end: new Date("2026-09-22T00:00:00Z") }, posts,
      [{ platform: "instagram", week: "2026-08-24", median_views: 800, p25_views: 500, hit_rate: 0.4 },
       { platform: "instagram", week: "2026-09-14", median_views: 1200, p25_views: 700, hit_rate: 0.6 }], {});
    const ig = t.platforms[0]!;
    expect(ig).toMatchObject({ posts_this_period: 4, rolling_median_now: 1200, rolling_median_4w_ago: 800, best: { post_id: "p5", pi: 2.4 }, hit_rate: 0.5, comments_this_period: 12 });
    expect(ig.proven_mean_pi).toBe(2.3);
    expect(ig.test_mean_pi).toBe(0.6);
  });

  it("drops uncited claims and invented post ids", () => {
    const kept = keepCited([{ text: "a", post_ids: ["p1", "fake"] }, { text: "b", post_ids: ["nope"] }], new Set(["p1"]));
    expect(kept).toEqual([{ text: "a", post_ids: ["p1"] }]);
  });
});

describe("external post matching", () => {
  it("ranks briefs by caption similarity", () => {
    const r = scoreCandidates("Stop pricing custom cakes like this — send to a baker", [
      { brief_id: "brf_a", idea_id: "ide_a", platform: "instagram", created_at: new Date(), text: "Stop pricing custom cakes like this. Send this to a baker who undercharges" },
      { brief_id: "brf_b", idea_id: "ide_b", platform: "instagram", created_at: new Date(), text: "Our new sourdough range" },
    ]);
    expect(r[0]!.brief_id).toBe("brf_a");
    expect(r[0]!.score).toBeGreaterThan(0.3);
    expect(r[1]!.score).toBeLessThan(0.1);
  });
});

describe("comment questions", () => {
  it("detects questions", () => {
    expect(isQuestion("How much do you charge for a 3 tier cake?")).toBe(true);
    expect(isQuestion("how do you keep the icing from melting in lagos heat")).toBe(true);
    expect(isQuestion("Beautiful 😍")).toBe(false);
    expect(isQuestion("ok?")).toBe(false);
  });
});

describe("website text", () => {
  it("strips markup and scripts", () => {
    expect(htmlToText("<html><script>x()</script><h1>Cakes</h1><p>Custom &amp; fresh</p></html>")).toBe("Cakes\n Custom & fresh");
  });
});
