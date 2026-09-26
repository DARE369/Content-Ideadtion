import type { Db } from "../db.js";
import { critique, generateIdeas, validEvidenceIds, type Reviewed } from "../ai/ideator.js";
import { embed, toVector } from "../lib/embed.js";
import { newId } from "../lib/ids.js";
import { seededRng, type Rng } from "../lib/stats.js";
import { combine, loadEstimates, probBeatsBaseline, type EstimateIndex } from "../learning/model.js";
import { selectSlots, type Candidate } from "../learning/selection.js";
import { exploreShare } from "../learning/floor.js";
import {
  COLD_START_POSTS, confidenceLabel, goalFit, opportunityScore, proofFromOutliers, relativeLabel, type ScoreComponents,
} from "../scoring/opportunity.js";
import { isPlatform, type Features, type Platform } from "../types.js";
import { loadContext, type IdeationContext } from "./context.js";
import { citedMomentum, citedOutlierRatios, resolveEvidence } from "./evidence.js";
import { DUPLICATE_SIMILARITY, nearestSimilarity, whiteSpace } from "./whitespace.js";
import { applyGuidance } from "./guidance.js";
import { prepareDraftBriefs } from "../handoff/briefs.js";

/**
 * Nightly (and after every analytics update): generate, critique, score and
 * shortlist Idea Cards so "Give me ideas" is a database read (< 1 s), and
 * pre-render the Autopilot briefs as drafts (< 3 s to queue).
 */

export const SHORTLIST_SIZE = 8;

export interface ScoredIdea extends Candidate {
  idea: Reviewed;
  platform: Platform | null;
  components: ScoreComponents;
  evidenceN: number;
  outside: { sources: number; proof: number };
  embedding: number[] | null;
}

/** Match the model's product name to the Brand Brain's offers; anything else counts as brand-building. */
export function matchOffer(sells: string | undefined, offers: { name: string }[]): string {
  const s = (sells ?? "").trim().toLowerCase();
  if (!s || s === "brand") return "brand";
  const exact = offers.find((o) => o.name.toLowerCase() === s);
  const loose = exact ?? offers.find((o) => s.includes(o.name.toLowerCase()) || o.name.toLowerCase().includes(s));
  return loose?.name ?? "brand";
}

export function toFeatures(idea: Reviewed, language: string, offers: { name: string }[] = []): Features {
  const f: Features = { ...idea.features, language, offer: matchOffer(idea.sells, offers) };
  if (idea.funnel_stage) f.funnel_stage = idea.funnel_stage;
  if (f.length_bucket === "n/a") delete f.length_bucket;
  return f;
}

/** Independent cited sources that aren't generic trend feeds (those only count when clearly rising). */
export function outsideSources(ctx: IdeationContext, ids: string[]): number {
  return resolveEvidence(ctx, [...new Set(ids)]).filter((e) => {
    if (e.kind !== "trend") return true;
    const m = ctx.signals.find((s) => s.id === e.id)?.momentum ?? 0;
    return m >= 0.6;
  }).length;
}

export function scoreIdea(
  ctx: IdeationContext, idea: Reviewed, platform: Platform | null, est: EstimateIndex | null, W: number,
): { components: ScoreComponents; score: number; evidenceN: number; outside: { sources: number; proof: number } } {
  const features = toFeatures(idea, ctx.brain.language, ctx.brain.offers);
  const posts = platform ? ctx.postsWithResults[platform] ?? 0 : 0;
  let L: number | null = null;
  let evidenceN = 0;
  if (platform && est && posts >= COLD_START_POSTS) {
    const c = combine(features, est);
    L = probBeatsBaseline(c.mu, c.se);
    evidenceN = c.evidenceN;
  }
  const components: ScoreComponents = {
    L,
    F: idea.brand_fit,
    P: proofFromOutliers(citedOutlierRatios(ctx, idea.evidence_ids)),
    M: citedMomentum(ctx, idea.evidence_ids),
    W,
    G: goalFit(ctx.brain.goal, idea.features.format),
  };
  return { components, score: opportunityScore(components, posts), evidenceN, outside: { sources: outsideSources(ctx, idea.evidence_ids), proof: components.P } };
}

export async function precomputeWorkspace(db: Db, workspaceId: string, rng: Rng = seededRng(Date.now())): Promise<{ run_id: string; shortlisted: number; drafted: number; kept: number } | null> {
  const ctx = await loadContext(db, workspaceId);
  if (!ctx) return null;
  const runId = newId("run");
  const valid = validEvidenceIds(ctx);

  const drafts = await generateIdeas(db, ctx);
  const reviewed = (await critique(db, ctx, drafts)).map((i) => ({
    ...i, evidence_ids: i.evidence_ids.filter((id) => valid.has(id)),
  }));
  const embeddings = await embed(reviewed.map((i) => `${i.title}. ${i.core_idea}`)).catch(() => null);

  const estimates = new Map<Platform, EstimateIndex>();
  for (const p of ctx.platforms) estimates.set(p, await loadEstimates(db, workspaceId, p));

  const scored: ScoredIdea[] = [];
  for (const [n, idea] of reviewed.entries()) {
    const emb = embeddings?.[n] ?? null;
    const sim = await nearestSimilarity(db, workspaceId, `${idea.title} ${idea.core_idea}`, emb);
    if (sim.recentIdea >= DUPLICATE_SIMILARITY) continue; // already suggested recently
    const platform = isPlatform(idea.platform) && ctx.platforms.includes(idea.platform) ? idea.platform : null;
    const s = scoreIdea(ctx, idea, platform, platform ? estimates.get(platform)! : null, whiteSpace(sim));
    scored.push({
      id: newId("ide"), idea, platform, components: s.components, score: s.score, evidenceN: s.evidenceN, outside: s.outside,
      features: toFeatures(idea, ctx.brain.language, ctx.brain.offers), embedding: emb,
    });
  }

  // Explore/exploit per platform; general ideas (no platform) fill with score order.
  const selected = new Map<string, "exploit" | "explore">();
  const groups = new Map<Platform | null, ScoredIdea[]>();
  for (const s of scored) groups.set(s.platform, [...(groups.get(s.platform) ?? []), s]);
  const perPlatform = Math.max(2, Math.ceil(SHORTLIST_SIZE / Math.max(1, ctx.platforms.length)));
  for (const [platform, group] of groups) {
    if (!platform) {
      for (const s of group.sort((a, b) => b.score - a.score).slice(0, perPlatform)) selected.set(s.id, "explore");
      continue;
    }
    const cold = (ctx.postsWithResults[platform] ?? 0) < COLD_START_POSTS;
    const share = await exploreShare(db, workspaceId, platform);
    const picks = applyGuidance(
      selectSlots(group, estimates.get(platform)!, perPlatform, share, rng, cold),
      group, ctx.rules.filter((r) => r.platform == null || r.platform === platform),
    );
    for (const p of picks) selected.set(p.item.id, p.slot);
  }

  const allScores = scored.map((s) => s.score);
  for (const s of scored) {
    const slot = selected.get(s.id);
    await db.query(
      `insert into ideas (id, workspace_id, run_id, mode, platform, title, why_now, core_idea, evidence, features, score,
          score_components, relative_label, confidence, content_type, effort, risks, slot, status, embedding, expires_at)
       values ($1,$2,$3,'give_me_ideas',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now() + interval '14 days')`,
      [s.id, workspaceId, runId, s.platform, s.idea.title, s.idea.why_now, s.idea.core_idea,
        JSON.stringify(resolveEvidence(ctx, s.idea.evidence_ids)), JSON.stringify(s.features), s.score,
        JSON.stringify(s.components), relativeLabel(s.score, allScores),
        confidenceLabel(s.evidenceN, s.platform ? ctx.postsWithResults[s.platform] ?? 0 : 0, s.outside),
        s.idea.content_type, s.idea.effort, s.idea.risks, slot ?? "explore", slot ? "shortlisted" : "candidate", toVector(s.embedding)],
    );
  }
  // The new shortlist replaces the previous one (selected/briefed ideas are untouched).
  await db.query(
    `update ideas set status = 'candidate' where workspace_id = $1 and status = 'shortlisted' and run_id is distinct from $2`,
    [workspaceId, runId],
  );
  await prepareDraftBriefs(db, workspaceId, ctx.platforms).catch((err) =>
    console.warn(`[precompute] draft briefs for ${workspaceId}: ${err instanceof Error ? err.message : err}`));
  return { run_id: runId, shortlisted: selected.size, drafted: drafts.length, kept: reviewed.length };
}

/**
 * Cheap rescoring after every analytics update: no Claude call. Recomputes the
 * learned fit (L) for the latest run's candidates from the fresh estimates and
 * re-runs explore/exploit, so the shortlist always reflects the newest results.
 */
export async function rescoreWorkspace(db: Db, workspaceId: string, rng: Rng = seededRng(Date.now())): Promise<number> {
  const ctx = await loadContext(db, workspaceId);
  if (!ctx) return 0;
  const run = await db.query<{ run_id: string }>(
    `select run_id from ideas where workspace_id = $1 and mode = 'give_me_ideas' and run_id is not null
     order by created_at desc limit 1`, [workspaceId],
  );
  const runId = run.rows[0]?.run_id;
  if (!runId) return 0;
  const rows = (await db.query<{ id: string; platform: string | null; features: Features; score_components: ScoreComponents; status: string; evidence: { kind: string }[] }>(
    `select id, platform, features, score_components, status, evidence from ideas
     where run_id = $1 and status in ('candidate', 'shortlisted')`, [runId],
  )).rows;

  const byPlatform = new Map<Platform | null, (Candidate & { components: ScoreComponents; confidence: string })[]>();
  const perPlatform = Math.max(2, Math.ceil(SHORTLIST_SIZE / Math.max(1, ctx.platforms.length)));
  for (const r of rows) {
    const platform = isPlatform(r.platform) ? r.platform : null;
    const posts = platform ? ctx.postsWithResults[platform] ?? 0 : 0;
    let L: number | null = null;
    let evidenceN = 0;
    if (platform && posts >= COLD_START_POSTS) {
      const c = combine(r.features, await loadEstimates(db, workspaceId, platform));
      L = probBeatsBaseline(c.mu, c.se);
      evidenceN = c.evidenceN;
    }
    const components = { ...r.score_components, L };
    const score = opportunityScore(components, posts);
    // Stored evidence has no momentum, so generic trend feeds don't count here.
    const sources = (r.evidence ?? []).filter((e) => e.kind !== "own_post" && e.kind !== "trend").length;
    const confidence = confidenceLabel(evidenceN, posts, { sources, proof: components.P ?? 0 });
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), { id: r.id, features: r.features, score, components, confidence }]);
  }

  const all = [...byPlatform.values()].flat();
  const allScores = all.map((c) => c.score);
  const slots = new Map<string, "exploit" | "explore">();
  for (const [platform, group] of byPlatform) {
    if (!platform) {
      for (const c of [...group].sort((a, b) => b.score - a.score).slice(0, perPlatform)) slots.set(c.id, "explore");
      continue;
    }
    const cold = (ctx.postsWithResults[platform] ?? 0) < COLD_START_POSTS;
    const picks = applyGuidance(
      selectSlots(group, await loadEstimates(db, workspaceId, platform), perPlatform, await exploreShare(db, workspaceId, platform), rng, cold),
      group, ctx.rules.filter((r) => r.platform == null || r.platform === platform),
    );
    for (const p of picks) slots.set(p.item.id, p.slot);
  }
  for (const c of all) {
    const slot = slots.get(c.id);
    await db.query(
      `update ideas set score = $2, score_components = $3, relative_label = $4, slot = $5, status = $6, confidence = $7 where id = $1`,
      [c.id, c.score, JSON.stringify(c.components), relativeLabel(c.score, allScores), slot ?? "explore", slot ? "shortlisted" : "candidate", c.confidence],
    );
  }
  return slots.size;
}
