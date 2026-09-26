import { z } from "zod";
import { CTA_TYPES } from "./shared.js";
import { OptimizationDraft } from "../../optimize/optimize.js";

export const ADAPTER_ROLE = `You are a platform-native content producer. Rebuild the chosen idea natively for ONE platform, following that platform's playbook exactly: its ranking signal, default format, hook timing, caption style and CTA. Do not port one script across platforms; write it for this platform from scratch.

The studio will generate the asset from your brief, so be concrete: exact on-screen text, shot list, timings, and the full script or copy. Keep within the playbook's length range.

Use the business's verified facts (proof, client stories, answers to buyer questions) to make it specific. Any number, price, client name or result must come from those facts; if there's none, make the point without a number.`;

const Beat = z.object({
  t: z.string().describe("time range like 0-2s, or 'slide 1' for carousels, 'line 1-3' for text posts"),
  beat: z.string(),
  on_screen_text: z.string().optional(),
  voiceover: z.string().optional(),
});

export const AdapterOutput = z.object({
  format: z.string(),
  hooks: z.array(z.string()).describe("exactly 3 hook options, strongest first"),
  structure: z.array(Beat),
  visual_direction: z.object({ style: z.string(), shots: z.array(z.string()) }),
  script_or_copy: z.string(),
  caption: z.string(),
  cta: z.object({ type: z.enum(CTA_TYPES).catch("none"), text: z.string() }),
  length_seconds_min: z.number().nullable(),
  length_seconds_max: z.number().nullable(),
  title: z.string().optional().describe("required for YouTube"),
  thumbnail_brief: z.string().optional().describe("required for YouTube"),
  do_not: z.array(z.string()),
  optimization: OptimizationDraft,
});
export type AdapterOutput = z.infer<typeof AdapterOutput>;

export const GENERAL_ROLE = `You write a format-neutral creative brief: the core idea, the messaging, the visual direction and 3 hook options, so the studio can later produce it for any platform. Do not assume a platform, aspect ratio or length.`;

export const GeneralOutput = z.object({
  hooks: z.array(z.string()).describe("exactly 3 hook options"),
  messaging: z.array(z.string()).describe("3-5 key messages in order"),
  visual_direction: z.object({ style: z.string(), shots: z.array(z.string()) }),
  caption: z.string(),
  cta: z.object({ type: z.enum(CTA_TYPES), text: z.string() }),
  suggested_formats: z.array(z.string()),
  do_not: z.array(z.string()),
});
export type GeneralOutput = z.infer<typeof GeneralOutput>;
