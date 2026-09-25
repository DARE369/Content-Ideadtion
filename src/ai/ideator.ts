import type { Db } from "../db.js";
import { structured } from "./client.js";
import { CRITIC_ROLE, CriticOutput, IDEATOR_ROLE, IdeatorOutput, type IdeaCandidate } from "./prompts/ideation.js";
import { FEATURE_VOCAB, HONESTY_RULES, brandBrainBlock, playbookBlock } from "./prompts/shared.js";
import { renderContext, type IdeationContext } from "../ideation/context.js";
import { PLATFORMS } from "../types.js";

/** Stable prefix: role, Brand Brain, playbooks, vocabulary, rules. Cached across calls. */
function prefix(role: string, ctx: IdeationContext): string[] {
  const platforms = ctx.platforms.length ? ctx.platforms : PLATFORMS;
  return [role, brandBrainBlock(ctx.brain), playbookBlock(platforms), FEATURE_VOCAB, HONESTY_RULES];
}

export async function generateIdeas(db: Db, ctx: IdeationContext, count = 15): Promise<IdeaCandidate[]> {
  const out = await structured({
    db, task: "ideator", workspaceId: ctx.brain.workspace_id, tier: "strategy",
    system: prefix(IDEATOR_ROLE, ctx),
    content: `${renderContext(ctx)}\n\nWrite ${count} ideas, spread across the connected platforms. Each idea must cite at least one evidence id from the tables above when any exist.`,
    schema: IdeatorOutput,
  });
  return out.ideas;
}

export interface Reviewed extends IdeaCandidate {
  brand_fit: number;
}

/** The Critic scores brand fit (F) with a fixed rubric and drops ideas that break the rules. */
export async function critique(db: Db, ctx: IdeationContext, ideas: IdeaCandidate[]): Promise<Reviewed[]> {
  if (ideas.length === 0) return [];
  const out = await structured({
    db, task: "critic", workspaceId: ctx.brain.workspace_id, tier: "fast",
    system: prefix(CRITIC_ROLE, ctx),
    content: `Review these ideas:\n${ideas.map((i, n) => `${n}. [${i.platform}/${i.content_type}] ${i.title} — ${i.core_idea}`).join("\n")}`,
    schema: CriticOutput,
    maxTokens: 8000,
  });
  const byIndex = new Map(out.reviews.map((r) => [r.index, r]));
  return ideas.flatMap((idea, i) => {
    const r = byIndex.get(i);
    if (!r || !r.keep) return [];
    return [{ ...idea, brand_fit: r.brand_fit, risks: [...new Set([...idea.risks, ...r.risks])] }];
  });
}

/** Drop any evidence id the model cited that was not in the input. */
export function validEvidenceIds(ctx: IdeationContext): Set<string> {
  return new Set([
    ...ctx.ownPosts.map((p) => p.id),
    ...ctx.competitorWinners.map((w) => w.id),
    ...ctx.signals.map((s) => s.id),
    ...ctx.questions.map((q) => q.id),
  ]);
}
