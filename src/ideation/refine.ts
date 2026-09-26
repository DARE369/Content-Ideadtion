import type { Db } from "../db.js";
import { streamText, structured } from "../ai/client.js";
import { SHARPEN_ROLE, SharpenOutput, VERDICT_ROLE } from "../ai/prompts/refine.js";
import { FEATURE_VOCAB, HONESTY_RULES, brandBrainBlock, playbookBlock } from "../ai/prompts/shared.js";
import type { IdeaCandidate } from "../ai/prompts/ideation.js";
import { newId } from "../lib/ids.js";
import { loadEstimates } from "../learning/model.js";
import { PLATFORMS, isPlatform, type Platform } from "../types.js";
import { loadContext, renderContext } from "./context.js";
import { resolveEvidence } from "./evidence.js";
import { scoreIdea, toFeatures } from "./precompute.js";
import { buildGeneralBrief, buildPlatformBrief } from "../handoff/briefs.js";
import { relativeLabel, confidenceLabel } from "../scoring/opportunity.js";
import { nearestSimilarity, whiteSpace } from "./whitespace.js";

/**
 * Refine my idea: a raw one-sentence idea (or a voice-note transcript) in, and
 * out, streamed: a verdict first (fast model, first words < 2 s), then a
 * sharpened version with 3 alternatives, then every platform version, built in
 * parallel (< 20 s total).
 */

export type RefineEvent =
  | { type: "verdict_delta"; text: string }
  | { type: "verdict_done"; text: string }
  | { type: "ideas"; sharpened: RefinedIdea; alternatives: RefinedIdea[] }
  | { type: "platform_brief"; platform: Platform | "general"; brief: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

export interface RefinedIdea {
  idea_id: string;
  title: string;
  core_idea: string;
  why_now: string;
  score: number;
  relative: string;
  confidence: string;
  label: "test";
  features: Record<string, string>;
}

export async function refineIdea(
  db: Db, workspaceId: string, rawIdea: string, platforms: string[], emit: (e: RefineEvent) => void,
): Promise<void> {
  const ctx = await loadContext(db, workspaceId);
  if (!ctx) throw new Error("workspace has no confirmed Brand Brain");
  const targets = platforms.filter(isPlatform);
  const prefixPlatforms = ctx.platforms.length ? ctx.platforms : PLATFORMS;
  const system = (role: string) => [role, brandBrainBlock(ctx.brain), playbookBlock(prefixPlatforms), FEATURE_VOCAB, HONESTY_RULES];
  const tables = renderContext(ctx);

  // 1. Verdict, streamed from the fast model.
  const verdict = await streamText(
    { db, task: "refine:verdict", workspaceId, tier: "fast", system: system(VERDICT_ROLE), content: `${tables}\n\nRaw idea: ${rawIdea}`, maxTokens: 600 },
    (text) => emit({ type: "verdict_delta", text }),
  );
  emit({ type: "verdict_done", text: verdict });

  // 2. Sharpened idea + 3 alternatives, scored like any other card.
  const out = await structured({
    db, task: "refine:sharpen", workspaceId, tier: "strategy", system: system(SHARPEN_ROLE),
    content: `${tables}\n\nRaw idea: ${rawIdea}\nTarget platforms: ${targets.join(", ") || "general"}`,
    schema: SharpenOutput,
  });
  const all = [out.sharpened, ...out.alternatives.slice(0, 3)];
  const scored = await Promise.all(all.map(async (c: IdeaCandidate) => {
    const platform = isPlatform(c.platform) && ctx.platforms.includes(c.platform) ? c.platform : targets[0] ?? null;
    const est = platform ? await loadEstimates(db, workspaceId, platform) : null;
    const sim = await nearestSimilarity(db, workspaceId, `${c.title} ${c.core_idea}`, null);
    const s = scoreIdea(ctx, { ...c, brand_fit: 0.75 }, platform, est, whiteSpace(sim));
    return { c, platform, ...s };
  }));
  const scores = scored.map((s) => s.score);
  const saved: RefinedIdea[] = [];
  for (const s of scored) {
    const id = newId("ide");
    const features = toFeatures({ ...s.c, brand_fit: 0.75 }, ctx.brain.language, ctx.brain.offers) as Record<string, string>;
    const rel = relativeLabel(s.score, scores);
    const conf = confidenceLabel(s.evidenceN, s.platform ? ctx.postsWithResults[s.platform] ?? 0 : 0, s.outside);
    await db.query(
      `insert into ideas (id, workspace_id, mode, platform, title, why_now, core_idea, evidence, features, score, score_components,
          relative_label, confidence, content_type, effort, risks, slot, status)
       values ($1,$2,'refine',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'explore','candidate')`,
      [id, workspaceId, s.platform, s.c.title, s.c.why_now, s.c.core_idea, JSON.stringify(resolveEvidence(ctx, s.c.evidence_ids)),
        JSON.stringify(features), s.score, JSON.stringify(s.components), rel, conf, s.c.content_type, s.c.effort, s.c.risks],
    );
    saved.push({ idea_id: id, title: s.c.title, core_idea: s.c.core_idea, why_now: s.c.why_now, score: s.score, relative: rel, confidence: conf, label: "test", features });
  }
  emit({ type: "ideas", sharpened: saved[0]!, alternatives: saved.slice(1) });

  // 3. Platform versions of the sharpened idea, one adapter call each, in parallel.
  //    Drafts only: nothing reaches the studio until the user hands one off.
  const ideaRow = (await db.query(
    `select id, workspace_id, title, why_now, core_idea, content_type, features, evidence, relative_label, confidence, label, risks
     from ideas where id = $1`, [saved[0]!.idea_id],
  )).rows[0];
  await Promise.all((targets.length ? targets : [null]).map(async (p) => {
    try {
      const brief = p ? await buildPlatformBrief(db, ideaRow, ctx.brain, p) : await buildGeneralBrief(db, ideaRow, ctx.brain);
      await db.query(
        `insert into briefs (id, idea_id, workspace_id, kind, platform, payload, status) values ($1,$2,$3,$4,$5,$6,'draft')`,
        [brief.brief_id, brief.idea_id, workspaceId, brief.kind, p, JSON.stringify(brief)],
      );
      emit({ type: "platform_brief", platform: p ?? "general", brief });
    } catch (err) {
      emit({ type: "error", message: `${p ?? "general"}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }));
  emit({ type: "done" });
}
