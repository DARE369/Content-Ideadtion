import type Anthropic from "@anthropic-ai/sdk";
import { ADAPTER_ROLE, GENERAL_ROLE } from "../../src/ai/prompts/briefs.js";
import { CRITIC_ROLE, IDEATOR_ROLE } from "../../src/ai/prompts/ideation.js";
import { AUTOPSY_ROLE, REPORT_ROLE } from "../../src/ai/prompts/reports.js";
import { SHARPEN_ROLE } from "../../src/ai/prompts/refine.js";

/**
 * A fake Anthropic client that answers by task (identified from the cached
 * system prefix) with schema-valid outputs built from ids found in the prompt.
 */

const usage = { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 };
export const calls: { task: string; model: string }[] = [];

const idea = (n: number, platform: string, hook: string, evidence: string[]) => ({
  title: `Idea ${n}: why custom cakes lose money (${hook})`,
  why_now: "Your audience asked about pricing three times this week.",
  core_idea: `Angle ${n} on pricing custom cakes with a ${hook} opener`,
  platform,
  content_type: platform === "tiktok" ? "vertical_video" : "reel",
  effort: "low",
  features: {
    hook_type: hook, format: platform === "tiktok" ? "vertical_video" : "reel", pillar: "pricing",
    idea_source: "audience_question", cta_type: "link_in_bio", visual_style: "talking_head", length_bucket: "16-30s",
  },
  evidence_ids: evidence,
  risks: [],
});

function textOf(content: Anthropic.MessageParam["content"]): string {
  return typeof content === "string" ? content : content.map((b) => ("text" in b ? b.text : "")).join("\n");
}

function answer(system: string, user: string): unknown {
  const ids = [...new Set(user.match(/\b(pst|cpp|sig|cmt)_[A-Za-z0-9_]+/g) ?? [])];
  if (system.startsWith(IDEATOR_ROLE)) {
    const hooks = ["price_reveal", "question", "myth_bust", "story", "list", "mistake"];
    return { ideas: Array.from({ length: 12 }, (_, n) => idea(n, n % 2 ? "tiktok" : "instagram", hooks[n % hooks.length]!, [...ids.slice(0, 2), "pst_invented"])) };
  }
  if (system.startsWith(CRITIC_ROLE)) {
    const n = (user.match(/^\d+\./gm) ?? []).length;
    return { reviews: Array.from({ length: n }, (_, index) => ({ index, brand_fit: index === 11 ? 0.2 : 0.8, keep: index !== 11, risks: [], reason: "ok" })) };
  }
  if (system.startsWith(ADAPTER_ROLE)) {
    return {
      format: user.includes("tiktok brief") ? "vertical_video" : "reel",
      hooks: ["Hook A", "Hook B", "Hook C"],
      structure: [{ t: "0-2s", beat: "hook", on_screen_text: "₦45k cake, ₦52k cost" }],
      visual_direction: { style: "bright kitchen", shots: ["receipt close-up"] },
      script_or_copy: "Script…",
      caption: "Send this to a baker who undercharges",
      cta: { type: "link_in_bio", text: "Get the pricing sheet" },
      length_seconds_min: 20, length_seconds_max: 35,
      do_not: ["no logo intro"],
    };
  }
  if (system.startsWith(GENERAL_ROLE)) {
    return {
      hooks: ["G1", "G2", "G3"], messaging: ["Price for time"], visual_direction: { style: "warm", shots: ["hands"] },
      caption: "c", cta: { type: "comment", text: "Tell us your price" }, suggested_formats: ["reel", "carousel"], do_not: [],
    };
  }
  if (system.startsWith(SHARPEN_ROLE)) {
    return { sharpened: idea(100, "instagram", "price_reveal", ids.slice(0, 1)), alternatives: [0, 1, 2].map((k) => idea(101 + k, "tiktok", "question", [])) };
  }
  if (system.startsWith(REPORT_ROLE)) {
    const posts = ids.filter((i) => i.startsWith("pst_"));
    return {
      headline: "Price reveals keep winning",
      what_worked: [{ text: "Price reveals averaged well above baseline", post_ids: posts.slice(0, 2) }],
      what_didnt: [{ text: "Invented claim", post_ids: ["pst_does_not_exist"] }],
      why: [{ text: "Viewers stop for a number", post_ids: posts.slice(0, 1) }],
      what_next: [
        { platform: "instagram", feature: "hook_type", value: "price_reveal", action: "prefer", share: 0.67, rationale: "2 of 3 reels", post_ids: posts.slice(0, 2) },
        { platform: "instagram", feature: "not_a_feature", value: "x", action: "avoid", share: null, rationale: "bad", post_ids: posts.slice(0, 1) },
      ],
      nudges: ["Reply to comments in the first hour"],
    };
  }
  if (system.startsWith(AUTOPSY_ROLE)) {
    return { verdict: "beat_baseline", summary: "Did 2.4x.", takeaway: "Keep the price reveal.", cited_post_ids: ids.slice(0, 1) };
  }
  throw new Error(`fake anthropic: unknown task for system prompt "${system.slice(0, 60)}"`);
}

export function fakeAnthropic(): Anthropic {
  return {
    messages: {
      parse: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        const system = (params.system as Anthropic.TextBlockParam[])[0]!.text;
        calls.push({ task: system.slice(0, 30), model: params.model });
        const parsed_output = answer(system, textOf(params.messages[0]!.content));
        return { usage, stop_reason: "end_turn", stop_details: null, parsed_output, content: [] };
      },
      stream: (params: Anthropic.MessageCreateParamsStreaming) => {
        calls.push({ task: "stream", model: params.model });
        const handlers: ((t: string) => void)[] = [];
        return {
          on: (_e: string, h: (t: string) => void) => handlers.push(h),
          finalMessage: async () => {
            for (const t of ["Strong — ", "price reveals ", "work for you."]) handlers.forEach((h) => h(t));
            return { usage, stop_reason: "end_turn", content: [{ type: "text", text: "Strong — price reveals work for you." }] };
          },
        };
      },
    },
  } as unknown as Anthropic;
}
