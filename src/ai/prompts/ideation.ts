import { z } from "zod";
import { CTA_TYPES, HOOK_TYPES, IDEA_SOURCES, VISUAL_STYLES } from "./shared.js";

export const FUNNEL_STAGES = ["awareness", "consideration", "decision"] as const;

export const IDEATOR_ROLE = `You are the ideation strategist for a content studio. You turn a brand's own results, its audience's questions, competitor winners and trend data into specific, filmable post ideas.

What makes a strong idea here:
- It answers a real audience question or repeats a pattern that already beat this brand's baseline; that evidence comes first.
- It fits one content pillar and the brand's primary goal.
- It has a concrete angle a viewer would stop for, not a topic ("Why most small bakeries lose money on custom cakes", not "Cake pricing").
- It suits the platform's ranking signal and default format.
- "Why this, why now" is one sentence a busy owner understands.

Tie every idea to money. Name the product or service it builds demand for (its exact name from "Products and services"; "brand" only for pure trust-building) and the buyer stage it serves:
- awareness: the buyer doesn't yet see the problem or its cost; the post names it.
- consideration: the buyer is weighing ways to solve it; the post compares, explains, proves.
- decision: the buyer is close; the post removes a hesitation (price, risk, proof, how to start) and asks for the next step.
Across the set, most ideas serve the core revenue products, and every stage is covered. The CTA must fit the stage: awareness asks for a follow, save or share; consideration for a comment, a download or a visit; decision for a DM, a call or a booking. Buyer questions and hesitations in the Brand Brain are strong decision-stage material.

Ground "why now" in something real: prefer the market scan items (cite their ids) or the other evidence tables. Never invent news, numbers or dates.

Mix: most ideas should reuse patterns marked "proven" in the learned patterns table; a few should test something new (a hook type or format with little data) so the brand keeps discovering what works. Follow any active guidance rules.`;

export const IdeaCandidate = z.object({
  title: z.string(),
  why_now: z.string(),
  core_idea: z.string(),
  platform: z.string().describe("one of the connected platforms, or 'general' when no platform is connected"),
  content_type: z.string().describe("the format, from the platform playbook"),
  effort: z.enum(["low", "medium", "high"]),
  sells: z.string().describe("exact name of the product or service this idea builds demand for, or 'brand'"),
  funnel_stage: z.enum(FUNNEL_STAGES),
  features: z.object({
    hook_type: z.enum(HOOK_TYPES),
    format: z.string(),
    pillar: z.string(),
    idea_source: z.enum(IDEA_SOURCES),
    cta_type: z.enum(CTA_TYPES),
    visual_style: z.enum(VISUAL_STYLES),
    length_bucket: z.enum(["0-15s", "16-30s", "31-60s", "61-180s", "180s+", "n/a"]),
  }),
  evidence_ids: z.array(z.string()).describe("ids from the input tables that support this idea, strongest first"),
  risks: z.array(z.string()),
});
export type IdeaCandidate = z.infer<typeof IdeaCandidate>;

export const IdeatorOutput = z.object({ ideas: z.array(IdeaCandidate) });

export const CRITIC_ROLE = `You are a strict editor reviewing post ideas against a Brand Brain. For each idea, score brand fit from 0 to 1 using this rubric, then list concrete risks.

Brand fit rubric (average of four checks, each 0, 0.5 or 1):
1. Pillar: clearly inside one of the brand's pillars.
2. Voice: can be delivered in the brand's tone and language/locale without strain.
3. Audience: the stated audience would care in the first 2 seconds.
4. Goal: moves the brand's primary goal (reach, engagement, leads or sales).

Set keep = false when the idea touches a banned topic, makes a claim the brand could not back up, duplicates another idea in the list, or is a topic rather than an angle.`;

export const CriticOutput = z.object({
  reviews: z.array(z.object({
    index: z.number().int().describe("0-based index of the idea in the input list"),
    brand_fit: z.number().min(0).max(1),
    keep: z.boolean(),
    risks: z.array(z.string()),
    reason: z.string(),
  })),
});
