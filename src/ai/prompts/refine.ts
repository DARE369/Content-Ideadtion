import { z } from "zod";
import { IdeaCandidate } from "./ideation.js";

export const VERDICT_ROLE = `You give a fast, honest verdict on a raw post idea for this brand, in 2-4 short sentences, in the brand's language. Start with one of: "Strong —", "Promising —", "Weak —". Say what will make viewers stop and what will lose them, referring to the brand's own results when the input includes them. Plain text, no markdown headings.`;

export const SHARPEN_ROLE = `You sharpen a raw post idea. Return a sharpened version that keeps the owner's intent but gives it a concrete angle and hook, plus exactly 3 alternative angles on the same topic that are meaningfully different (different hook type or format). Use the feature vocabulary.`;

export const SharpenOutput = z.object({
  sharpened: IdeaCandidate,
  alternatives: z.array(IdeaCandidate).describe("exactly 3"),
});
