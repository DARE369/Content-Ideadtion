import { z } from "zod";
import { GOALS, PLATFORMS } from "../types.js";
import { Optimization } from "../optimize/optimize.js";

/** brief.v1 — the JSON the studio receives. Idempotent on brief_id. */

const Hooks = z.array(z.string().min(1)).length(3);

const Beat = z.object({
  t: z.string(), // "0-2s", or "slide 1" for carousels
  beat: z.string(),
  on_screen_text: z.string().optional(),
  voiceover: z.string().optional(),
});

const VisualDirection = z.object({
  style: z.string(),
  brand_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{3,8}$/)),
  shots: z.array(z.string()),
});

const Cta = z.object({
  type: z.enum(["link_in_bio", "link", "comment", "dm", "save", "share", "follow", "subscribe", "question", "none"]),
  text: z.string().optional(),
  url: z.string().url().optional(),
});

const Score = z.object({
  relative: z.enum(["top_third", "middle_third", "bottom_third"]),
  confidence: z.enum(["low", "medium", "high"]),
});

const Common = z.object({
  schema: z.literal("brief.v1"),
  brief_id: z.string().startsWith("brf_"),
  idea_id: z.string().startsWith("ide_"),
  workspace_id: z.string().startsWith("wsp_"),
  language: z.string().min(2),
  goal: z.enum(GOALS),
  core_idea: z.string().min(1),
  hooks: Hooks,
  visual_direction: VisualDirection,
  caption: z.string(),
  cta: Cta,
  do_not: z.array(z.string()),
  evidence_ids: z.array(z.string()),
  score: Score,
  label: z.enum(["proven", "test"]),
  created_at: z.string().datetime(),
  // Week 2 additions (optional, so brief.v1 stays compatible).
  product: z.object({ name: z.string(), url: z.string().nullable() }).optional(),
  campaign: z.object({ id: z.string(), name: z.string(), phase: z.string().nullable(), objective: z.string().nullable() }).optional(),
  buyer_stage: z.enum(["awareness", "consideration", "decision"]).optional(),
  facts: z.array(z.object({ id: z.string(), text: z.string(), url: z.string().nullable() })).optional(),
  review_notes: z.array(z.string()).optional(),
});

export const PlatformBrief = Common.extend({
  kind: z.literal("platform"),
  platform: z.enum(PLATFORMS),
  format: z.string(),
  structure: z.array(Beat).min(1),
  script_or_copy: z.string(),
  length_seconds: z.tuple([z.number().nonnegative(), z.number().positive()]).nullable(),
  aspect_ratio: z.enum(["9:16", "1:1", "4:5", "16:9", "1.91:1"]),
  // Title and thumbnail matter most on YouTube; optional elsewhere.
  title: z.string().optional(),
  thumbnail_brief: z.string().optional(),
  optimization: Optimization.optional(),
});

export const GeneralBrief = Common.extend({
  kind: z.literal("general"),
  messaging: z.array(z.string()).min(1),
  suggested_formats: z.array(z.string()).min(1),
  structure: z.array(Beat).optional(),
  script_or_copy: z.string().optional(),
});

export const Brief = z.discriminatedUnion("kind", [PlatformBrief, GeneralBrief]);

export type PlatformBrief = z.infer<typeof PlatformBrief>;
export type GeneralBrief = z.infer<typeof GeneralBrief>;
export type Brief = z.infer<typeof Brief>;
