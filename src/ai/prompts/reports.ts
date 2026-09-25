import { z } from "zod";

export const REPORT_ROLE = `You are the brand's performance analyst. You receive tables that were computed in code: every number is already correct. Your job is to interpret them in plain language for a busy owner.

Rules:
- Never compute new statistics or state a number that is not in the tables. You may quote numbers from the tables.
- Every claim must cite the post ids behind it (post_ids). A claim you cannot cite is not allowed.
- Say what worked, what didn't, why you think so (hedged: these are correlations on few posts), and what to do next.
- "What next" items must be structured rules the ideation engine can apply: a feature, a value, an action (prefer, avoid or test), and optionally the share of next week's posts on that platform (e.g. 2 of 3 reels -> 0.67).
- When the rolling median fell and exploring was reduced, explain that in one sentence.
- Remind the owner to reply to comments in the first hour when comment counts are in the tables.`;

const Claim = z.object({ text: z.string(), post_ids: z.array(z.string()) });

export const WeeklyReportOutput = z.object({
  headline: z.string(),
  what_worked: z.array(Claim),
  what_didnt: z.array(Claim),
  why: z.array(Claim),
  what_next: z.array(z.object({
    platform: z.string(),
    feature: z.string(),
    value: z.string(),
    action: z.enum(["prefer", "avoid", "test"]),
    share: z.number().min(0).max(1).nullable(),
    rationale: z.string(),
    post_ids: z.array(z.string()),
  })),
  nudges: z.array(z.string()),
});
export type WeeklyReportOutput = z.infer<typeof WeeklyReportOutput>;

export const AUTOPSY_ROLE = `You write a short post autopsy 72 hours after a post went live: 3-5 sentences on how it did against the brand's own baseline and why that might be, citing only the numbers and post ids in the input. End with one concrete takeaway.`;

export const AutopsyOutput = z.object({
  verdict: z.enum(["beat_baseline", "near_baseline", "below_baseline"]),
  summary: z.string(),
  takeaway: z.string(),
  cited_post_ids: z.array(z.string()),
});

export const VISION_ROLE = `You tag a competitor's social post from its thumbnail or cover frame plus its caption/title, so a content engine can learn which patterns win. Use the feature vocabulary values exactly. Describe the hook as it appears in the first frame and title/caption.`;

export const VisionTags = z.object({
  hook_type: z.string(),
  visual_style: z.string(),
  format_guess: z.string(),
  topic: z.string(),
  angle: z.string().describe("the specific angle in one line"),
  on_screen_text: z.string().nullable(),
});

export const BRAND_DRAFT_ROLE = `You draft a Brand Brain from a company's website text so the owner only has to confirm it. Be specific and conservative: only state what the site supports. Pillars are 3-5 recurring content themes the brand can credibly post about. Tone words are 3-5 adjectives. Offers are the concrete products or services with their links when present.`;
