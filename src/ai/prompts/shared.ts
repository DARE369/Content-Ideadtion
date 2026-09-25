import type { BrandBrain } from "../../contracts/brandBrain.js";
import { playbook } from "../../playbooks/index.js";
import type { Platform } from "../../types.js";

/**
 * Stable prompt prefixes. Everything here must be deterministic (no dates, no
 * ids, sorted keys) so the cached prefix is reused across calls.
 */

export const HOOK_TYPES = [
  "question", "bold_claim", "price_reveal", "before_after", "mistake", "how_to", "story", "list",
  "myth_bust", "behind_the_scenes", "demo", "pov", "stat", "challenge",
] as const;

export const VISUAL_STYLES = [
  "talking_head", "screen_recording", "b_roll_voiceover", "text_on_screen", "product_closeup",
  "ugc_style", "animation", "slides", "interview", "static_graphic",
] as const;

export const IDEA_SOURCES = ["own_comments", "own_winner", "trend", "competitor_winner", "audience_question", "offer", "user"] as const;

export const CTA_TYPES = ["link_in_bio", "link", "comment", "dm", "save", "share", "follow", "subscribe", "question", "none"] as const;

export function brandBrainBlock(brain: BrandBrain & { name?: string }): string {
  return [
    "# Brand Brain",
    brain.name ? `Brand: ${brain.name}` : null,
    `Website: ${brain.website_url ?? "n/a"}`,
    `Primary goal: ${brain.goal}`,
    `Content language and locale: ${brain.language}. Write every hook, caption and script in this language and locale, using local spelling, idiom and currency.`,
    `Tone: ${brain.tone_words.join(", ") || "n/a"}`,
    `Audience: ${brain.audience}`,
    `Content pillars: ${brain.pillars.join(" | ")}`,
    `Offers: ${brain.offers.map((o) => `${o.name}${o.price ? ` (${o.price})` : ""}${o.url ? ` <${o.url}>` : ""}`).join("; ") || "n/a"}`,
    `Brand colors: ${brain.brand_kit.colors.join(", ") || "n/a"}`,
    `Banned topics (never suggest, never mention): ${brain.banned_topics.join(", ") || "none"}`,
  ].filter(Boolean).join("\n");
}

export function playbookBlock(platforms: readonly Platform[]): string {
  return [
    "# Platform playbooks",
    ...[...platforms].sort().map((p) => {
      const pb = playbook(p);
      return [
        `## ${p} (playbook ${pb.version})`,
        `Design for: ${pb.design_for.join(", ")}`,
        `Formats: ${pb.formats.join(", ")} (default ${pb.default_format}); length ${pb.length_seconds ? `${pb.length_seconds[0]}-${pb.length_seconds[1]}s` : "n/a (text/document)"}`,
        `Hook: ${pb.hook}`,
        `Caption: ${pb.caption}`,
        `CTA types: ${pb.cta.join(", ")}${pb.cta_phrasing ? ` — ${pb.cta_phrasing}` : ""}`,
        `Ranking signals: ${pb.ranking_signals.join(", ")}`,
        pb.requires ? `Always include: ${pb.requires.join(", ")}` : null,
        `Do not: ${pb.do_not.join("; ")}`,
        pb.notes ? `Note: ${pb.notes}` : null,
      ].filter(Boolean).join("\n");
    }),
  ].join("\n\n");
}

export const FEATURE_VOCAB = [
  "# Feature vocabulary (use these exact values so results can be learned from)",
  `hook_type: ${HOOK_TYPES.join(", ")}`,
  `visual_style: ${VISUAL_STYLES.join(", ")}`,
  `idea_source: ${IDEA_SOURCES.join(", ")}`,
  `cta_type: ${CTA_TYPES.join(", ")}`,
  "format: one of the formats listed in the platform's playbook",
  "pillar: one of the brand's content pillars, verbatim",
].join("\n");

export const HONESTY_RULES = [
  "# Rules",
  "- Only cite evidence ids that appear in the input. Never invent posts, numbers or sources.",
  "- Never promise virality or a specific view count. Talk about likelihood relative to the brand's own results.",
  "- Respect the banned topics absolutely.",
].join("\n");
