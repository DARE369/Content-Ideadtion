import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAnthropic } from "../../src/ai/client.js";
import { EXTRACT_ROLE } from "../../src/knowledge/extract.js";
import { createUpload, processUpload } from "../../src/knowledge/uploads.js";
import { draftCampaign, draftGrowthPlan, planCampaign, saveCampaign, saveObjective, campaignIdeas } from "../../src/plan/plan.js";
import { shortlist } from "../../src/ideation/cards.js";
import { loadContext } from "../../src/ideation/context.js";
import { sha256 } from "../../src/knowledge/discover.js";
import { freshDb } from "./setup.js";

const calls: string[] = [];
const usage = { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function idea(i: number, facts: string[]) {
  return {
    slot: i, title: `Campaign post ${i}`, why_now: "The assessment window closes in November.", core_idea: `Angle ${i} on digital readiness`,
    platform: "linkedin", content_type: "document_carousel", effort: "low", sells: "Readiness Assessment", funnel_stage: "awareness", objective: "",
    features: { hook_type: "question", format: "document_carousel", pillar: "Digital oilfield", idea_source: "trend", cta_type: "link_in_bio", visual_style: "slides", length_bucket: "n/a" },
    evidence_ids: [...facts.slice(0, 1), "kc_invented"], risks: [],
  };
}

const fake = {
  messages: {
    parse: async (p: Anthropic.MessageCreateParamsNonStreaming) => {
      const system = (p.system as Anthropic.TextBlockParam[]).map((b) => b.text).join("\n");
      const user = JSON.stringify(p.messages[0]!.content);
      let out: unknown;
      if (system.startsWith(EXTRACT_ROLE)) {
        calls.push("extract");
        out = { cards: [{ page: 0, type: "proof", title: "Shutdowns", body: "Cut unplanned shutdowns by 18%", attributes: [{ key: "metric", value: "18%" }], product: "Readiness Assessment", quote: "cut unplanned shutdowns by 18%", confidence: "high" }] };
      } else if (system.includes("growth strategist")) {
        calls.push("growth");
        out = { objectives: [{ title: "Win 3 new operators via the assessment", segment: "Upstream operators in Nigeria", products: ["Readiness Assessment"], motion: ["assessment", "pilot", "contract"], awareness_message: "a", consideration_message: "b", decision_message: "c", success_metric: "New contracts", target_value: 3, weight: 7 }] };
      } else if (system.includes("one sentence into a social media campaign brief")) {
        calls.push("campaign-draft");
        out = { name: "November readiness drive", goal: "leads", products: ["Readiness Assessment"], audience: "Ops leads", key_message: "Know your gaps in 2 weeks", offer: "Free assessment", cta_text: "Book your assessment", cta_url: "https://lordsway.example/assessment", start_date: "2026-11-02", end_date: "2026-11-13", platforms: ["linkedin", "myspace"], posts_per_week: 3, success_metric: "Bookings", target_value: 10, objective: "Win 3 new operators via the assessment" };
      } else if (system.includes("plan a social media campaign")) {
        calls.push("campaign-plan");
        const ids = [...user.matchAll(/kc_[A-Z0-9]+/g)].map((m) => m[0]);
        out = { ideas: Array.from({ length: 6 }, (_, i) => idea(i, ids)) };
      } else throw new Error(`unexpected system prompt: ${system.slice(0, 50)}`);
      return { usage, stop_reason: "end_turn", stop_details: null, parsed_output: out, content: [] };
    },
  },
} as unknown as Anthropic;

let pool: Awaited<ReturnType<typeof freshDb>>["pool"];
let drop: () => Promise<void>;
beforeAll(async () => {
  ({ pool, drop } = await freshDb());
  await pool.query("insert into workspaces (id, studio_workspace_id, name) values ('wsp_p', 'wsp_p', 'Lordsway Energy')");
  await pool.query(
    `insert into brand_brains (workspace_id, website_url, goal, language, tone_words, pillars, audience, offers, banned_topics, confirmed_at)
     values ('wsp_p', 'https://lordsway.example', 'leads', 'en-NG', '{expert}', '{Digital oilfield}', 'Operators', '[]', '{}', now())`,
  );
  await pool.query("insert into products (id, workspace_id, name, revenue_role, url, origin) values ('prd_ra', 'wsp_p', 'Readiness Assessment', 'lead_magnet', 'https://lordsway.example/assessment', 'user')");
  await pool.query("insert into connected_accounts (id, workspace_id, platform, external_account_id, studio_connection_id) values ('acc_li', 'wsp_p', 'linkedin', 'x', 's')");
  setAnthropic(fake);
});
afterAll(async () => drop?.());

describe("uploads, growth plan and campaigns", () => {
  it("an uploaded brochure becomes cards once; the same file again costs nothing", async () => {
    const text = "Readiness Assessment. In 2025 our programme helped a Delta operator cut unplanned shutdowns by 18% within six months.";
    const sha = sha256("brochure-bytes");
    const { upload, upload_url, storage } = await createUpload(pool, "wsp_p", { filename: "brochure.pdf", mime: "application/pdf", size: 1000, sha256: sha });
    expect(storage).toBe(false);
    expect(upload_url).toBeNull();
    const done = await processUpload(pool, "wsp_p", upload.id, { text, pages: 2 });
    expect(done).toMatchObject({ status: "processed", cards_added: 1, pages: 2 });
    const card = (await pool.query("select product_ids, sources from knowledge_cards where workspace_id = 'wsp_p'")).rows[0];
    expect(card.product_ids).toEqual(["prd_ra"]);
    expect(card.sources[0]).toMatchObject({ kind: "upload", ref: upload.id });
    const again = await createUpload(pool, "wsp_p", { filename: "copy.pdf", mime: "application/pdf", size: 1000, sha256: sha });
    expect(again.existing).toBe(true);
    await expect(createUpload(pool, "wsp_p", { filename: "deck.pptx", mime: "application/vnd.ms-powerpoint", size: 10, sha256: sha })).rejects.toThrow(/save as PDF/);
    expect(calls.filter((c) => c === "extract")).toHaveLength(1);
  });

  it("drafts a growth plan tied to real products", async () => {
    const [o] = await draftGrowthPlan(pool, "wsp_p", { must_happen: "3 new clients", customers: "", key_products: "assessment", path_to_sale: "", measure: "" });
    expect(o).toMatchObject({ product_ids: ["prd_ra"], motion: ["assessment", "pilot", "contract"], weight: 7, target_value: 3 });
    await saveObjective(pool, "wsp_p", o!);
    const ctx = await loadContext(pool, "wsp_p");
    expect(ctx!.objectives[0]!.title).toBe("Win 3 new operators via the assessment");
    expect(ctx!.facts.length).toBe(1);
  });

  it("drafts a campaign from a sentence, then plans dated, phased ideas that cite real facts only", async () => {
    const draft = await draftCampaign(pool, "wsp_p", "Push the free readiness assessment to Nigerian operators in the first half of November");
    expect(draft.platforms).toEqual(["linkedin"]);
    expect(draft.objective_id).toBeTruthy();
    expect(draft.product_ids).toEqual(["prd_ra"]);
    const c = await saveCampaign(pool, "wsp_p", { ...draft, posts_per_week: 3 });
    const r = await planCampaign(pool, "wsp_p", c.id);
    expect(r.created).toBe(6);
    const ideas = await campaignIdeas(pool, "wsp_p", c.id);
    expect(ideas.map((i) => i.planned_for)).toEqual(["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"]);
    expect(ideas[0].campaign_phase).toBe("Problem");
    expect(ideas[5].features.funnel_stage).toBe("decision");
    expect(ideas.every((i) => i.grounded)).toBe(true);
    expect(ideas.every((i) => i.evidence.every((e: { id: string }) => e.id !== "kc_invented"))).toBe(true);
    const status = (await pool.query("select status from campaigns where id = $1", [c.id])).rows[0].status;
    expect(status).toBe("active");
    // Re-planning replaces the unbriefed ideas rather than piling up.
    await planCampaign(pool, "wsp_p", c.id);
    expect(await campaignIdeas(pool, "wsp_p", c.id)).toHaveLength(6);
    // This week shows campaign posts planned within the next 7 days (none yet: they're in November).
    const week = await shortlist(pool, "wsp_p");
    expect(week.filter((i) => i.campaign_id)).toHaveLength(ideas.filter((i) => Date.parse(i.planned_for) <= Date.now() + 7 * 86_400_000).length);
  });
});
