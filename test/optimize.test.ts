import { describe, expect, it } from "vitest";
import { figuresIn, finalizeOptimization, optimizationFeatures, suggestedAngle, unverifiedFigures, validChapters, type OptimizationDraft } from "../src/optimize/optimize.js";
import { assignPhases, defaultPhases, slotDates } from "../src/plan/plan.js";
import { splitText } from "../src/knowledge/uploads.js";

const draft = (over: Partial<OptimizationDraft> = {}): OptimizationDraft => ({
  primary_keyword: "digital oilfield Nigeria", secondary_keywords: ["well monitoring", "", "production data", "a", "b"],
  titles: ["Digital oilfield Nigeria: 3 costly gaps", "Digital oilfield Nigeria: 3 costly gaps", "Why wells go dark", "X".repeat(150), "Fourth"],
  title_style: "number", description: "Digital oilfield Nigeria explained.",
  chapters: [{ t: "0:03", title: "Hook" }, { t: "0:08", title: "Too soon" }, { t: "0:40", title: "Gap 1" }, { t: "1:20", title: "Gap 2" }],
  thumbnails: [{ concept: "Dark well site at night", text: "Your wells are blind right now", subject: "well head", layout: "subject left" }],
  thumbnail_style: "scene", caption_first_line: "Digital oilfield Nigeria", on_screen_text: ["digital oilfield"], spoken_keyword_line: "Digital oilfield in Nigeria",
  alt_text: "A well head at night", hashtags: ["oilandgas", "#Nigeria", "digital oilfield", "#a", "energy", "x1", "x2", "x3"], misspelling_tags: ["digital oil field"],
  ...over,
});

describe("platform optimisation", () => {
  it("YouTube: 3 unique titles within 100 characters, valid chapters, thumbnail text of 4 words, spec and misspelling tags", () => {
    const o = finalizeOptimization("youtube", draft(), { brandColors: ["#000000", "#7ac143"], lengthSeconds: 180 });
    expect(o.titles).toHaveLength(3);
    expect(o.titles!.every((t) => t.length <= 100)).toBe(true);
    expect(new Set(o.titles).size).toBe(3);
    expect(o.chapters).toEqual([{ t: "00:00", title: "Hook" }, { t: "00:40", title: "Gap 1" }, { t: "01:20", title: "Gap 2" }]);
    expect(o.thumbnails![0]!.text).toBe("Your wells are blind");
    expect(o.thumbnails![0]!.colors).toEqual(["#000000", "#7ac143"]);
    expect(o.thumbnail_spec).toMatchObject({ size: "1280x720", ratio: "16:9", max_mb: 2 });
    expect(o.hashtags).toHaveLength(3);
    expect(o.tags).toEqual(["digital oil field"]);
    expect(o.alt_text).toBeUndefined();
  });
  it("Instagram: no YouTube fields; hashtags capped at 5 and cleaned; alt text kept", () => {
    const o = finalizeOptimization("instagram", draft(), { brandColors: [], lengthSeconds: 30 });
    expect(o.titles).toBeUndefined();
    expect(o.chapters).toBeUndefined();
    expect(o.hashtags).toEqual(["#oilandgas", "#Nigeria", "#digitaloilfield", "#energy", "#x1"]);
    expect(o.alt_text).toBe("A well head at night");
    expect(o.secondary_keywords).toEqual(["well monitoring", "production data", "a", "b"]);
  });
  it("chapters need at least three, 10 s apart, starting at zero", () => {
    expect(validChapters([{ t: "0:00", title: "a" }, { t: "0:05", title: "b" }], 60)).toEqual([]);
    expect(validChapters([{ t: "00:02", title: "a" }, { t: "0:20", title: "b" }, { t: "1:02:00", title: "c" }], null)).toEqual([
      { t: "00:00", title: "a" }, { t: "00:20", title: "b" }, { t: "62:00", title: "c" },
    ]);
  });
  it("records what the learning loop tracks", () => {
    const o = finalizeOptimization("youtube", draft(), { brandColors: [], lengthSeconds: 180 });
    expect(optimizationFeatures(o)).toEqual({ title_style: "number", thumbnail_style: "scene", keyword_in_title: "yes" });
  });
  it("keyword check advice depends on what already ranks", () => {
    expect(suggestedAngle("pump repair", [])).toMatch(/Few videos/);
    const crowded = [1, 2, 3].map((i) => ({ title: `Pump repair guide ${i}`, views: 500_000 }));
    expect(suggestedAngle("pump repair", crowded)).toMatch(/Crowded with big channels/);
    expect(suggestedAngle("pump repair", [{ title: "Fixing pumps", views: 900 }])).toMatch(/room here/);
  });
});

describe("figures rule", () => {
  it("finds figures that matter, ignores years and small counts", () => {
    expect(figuresIn("In 2025 we cut shutdowns by 18% for 3 operators, saving ₦45,000 and $1.2m")).toEqual(["18%", "₦45,000", "$1.2m"]);
  });
  it("flags figures that aren't in the sources", () => {
    const allowed = "Well Monitor cut unplanned shutdowns by 18% for a Niger Delta operator. Price from ₦45,000.";
    expect(unverifiedFigures("We cut shutdowns 18% and save 30% on fuel, from ₦45,000", allowed)).toEqual(["30%"]);
  });
});

describe("campaign schedule", () => {
  it("spreads posts across weekdays at the chosen rate", () => {
    const d = slotDates("2026-11-02", "2026-11-29", 3);
    expect(d).toHaveLength(12);
    expect(d[0]).toBe("2026-11-02");
    expect(d.every((x) => ![0, 6].includes(new Date(`${x}T00:00:00Z`).getUTCDay()))).toBe(true);
    expect(slotDates("2026-11-10", "2026-11-01", 3)).toEqual([]);
  });
  it("phases follow the arc in order, by share", () => {
    const p = assignPhases(10, defaultPhases("leads"));
    expect(p.map((x) => x.name)).toEqual(["Problem", "Problem", "Problem", "Approach", "Approach", "Proof", "Proof", "Proof", "Objections", "Last call"]);
    expect(p[0]!.stage).toBe("awareness");
    expect(p[9]!.stage).toBe("decision");
  });
});

describe("uploads", () => {
  it("splits long text into parts at line breaks", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Line ${i} ${"x".repeat(80)}`).join("\n");
    const parts = splitText(text, 500);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join("\n").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });
});
