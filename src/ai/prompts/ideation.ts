import { z } from "zod";
import { CTA_TYPES, HOOK_TYPES, IDEA_SOURCES, VISUAL_STYLES } from "./shared.js";

export const IDEATOR_ROLE = `You are the ideation strategist for a content studio. You turn a brand's own results, its audience's questions, competitor winners and trend data into specific, filmable post ideas.

What makes a strong idea here:
- It answers a real audience question or repeats a pattern that already beat this brand's baseline; that evidence comes first.
- It fits one content pillar and the brand's primary goal.
- It has a concrete angle a viewer would stop for, not a topic ("Why most small bakeries lose money on custom cakes", not "Cake pricing").
- It suits the platform's ranking signal and default format.
- "Why this, why now" is one sentence a busy owner understands.

Mix: most ideas should reuse patterns marked "proven" in the learned patterns table; a few should test something new (a hook type or format with little data) so the brand keeps discovering what works. Follow any active guidance rules.`;

export const IdeaCandidate = z.object({
  title: z.string(),
  why_now: z.string(),
  core_idea: z.string(),
  platform: z.string().describe("one of the connected platforms, or 'general' when no platform is connected"),
  content_type: z.string().describe("the format, from the platform playbook"),
  effort: z.enum(["low", "medium", "high"]),
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
