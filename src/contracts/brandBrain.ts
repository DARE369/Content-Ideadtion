import { z } from "zod";
import { GOALS } from "../types.js";

export const BrandBrain = z.object({
  website_url: z.string().url().nullable(),
  brand_kit: z
    .object({
      colors: z.array(z.string()).default([]),
      fonts: z.array(z.string()).default([]),
      logo_url: z.string().url().optional(),
    })
    .default({ colors: [], fonts: [] }),
  goal: z.enum(GOALS),
  language: z.string().min(2), // BCP 47 content language + locale, e.g. en-NG
  tone_words: z.array(z.string()).max(8),
  pillars: z.array(z.string()).min(1).max(6),
  audience: z.string(),
  offers: z.array(z.object({ name: z.string(), url: z.string().url().optional(), price: z.string().optional() })),
  banned_topics: z.array(z.string()),
});
export type BrandBrain = z.infer<typeof BrandBrain>;
