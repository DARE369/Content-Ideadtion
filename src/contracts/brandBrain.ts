import { z } from "zod";
import { GOALS } from "../types.js";

export const REVENUE_ROLES = ["core", "secondary", "lead_magnet"] as const;
export const SOCIAL_PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "youtube", "x", "threads", "whatsapp", "other"] as const;

/** A product or service, with how much of the business it carries. */
export const Offer = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  price: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  revenue_role: z.enum(REVENUE_ROLES).optional(),
});
export type Offer = z.infer<typeof Offer>;

export const SocialLink = z.object({ platform: z.enum(SOCIAL_PLATFORMS), url: z.string().url() });
export type SocialLink = z.infer<typeof SocialLink>;

export const BrandBrain = z.object({
  website_url: z.string().url().nullable(),
  description: z.string().optional(),
  industry: z.string().optional(),
  country: z.string().length(2).nullable().optional(),
  brand_kit: z
    .object({
      colors: z.array(z.string()).default([]),
      fonts: z.array(z.string()).default([]),
      logo_url: z.string().url().optional(),
    })
    .default({ colors: [], fonts: [] }),
  social_links: z.array(SocialLink).default([]),
  goal: z.enum(GOALS),
  language: z.string().min(2), // BCP 47 content language + locale, e.g. en-NG
  tone_words: z.array(z.string()).max(8),
  pillars: z.array(z.string()).min(1).max(6),
  audience: z.string(),
  /** Questions buyers ask before they buy, in their words. */
  buyer_questions: z.array(z.string()).max(15).default([]),
  /** What makes buyers hesitate: price, risk, switching cost, trust. */
  objections: z.array(z.string()).max(15).default([]),
  offers: z.array(Offer),
  banned_topics: z.array(z.string()),
});
export type BrandBrain = z.infer<typeof BrandBrain>;
