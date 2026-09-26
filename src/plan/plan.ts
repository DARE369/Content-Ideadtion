import { z } from "zod";
import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { FEATURE_VOCAB, HONESTY_RULES, brandBrainBlock, playbookBlock } from "../ai/prompts/shared.js";
import { IdeaCandidate } from "../ai/prompts/ideation.js";
import { newId } from "../lib/ids.js";
import { loadContext, renderContext, type IdeationContext } from "../ideation/context.js";
import { resolveEvidence } from "../ideation/evidence.js";
import { ideaLinks, scoreIdea, toFeatures } from "../ideation/precompute.js";
import { confidenceLabel, relativeLabel } from "../scoring/opportunity.js";
import { markUsed, renderFacts, retrieveFacts } from "../knowledge/retrieve.js";
import { listProducts } from "../knowledge/products.js";
import { loadEstimates } from "../learning/model.js";
import { PLATFORMS, isPlatform, type Platform } from "../types.js";

/**
 * The growth plan (business development objectives) sits above campaigns, and
 * campaigns above ideas, so every idea and brief carries
 * objective -> campaign -> product -> buyer stage.
 */

export class PlanError extends Error {}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export const ObjectiveInput = z.object({
  title: z.string().min(3).max(200),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  segment: z.string().max(300).nullable().optional(),
  product_ids: z.array(z.string()).max(12).default([]),
  motion: z.array(z.string().max(80)).max(8).default([]),
  stage_messages: z.record(z.string(), z.string()).default({}),
  success_metric: z.string().max(200).nullable().optional(),
  target_value: z.number().nullable().optional(),
  current_value: z.number().nullable().optional(),
  weight: z.number().min(0).max(100).default(1),
  status: z.enum(["active", "done", "paused"]).default("active"),
});
export type ObjectiveInput = z.infer<typeof ObjectiveInput>;

export async function listObjectives(db: Db, ws: string) {
  return (await db.query(
    `select o.*, o.weight::float8 as weight, o.target_value::float8 as target_value, o.current_value::float8 as current_value,
            o.period_start::text as period_start, o.period_end::text as period_end,
            (select count(*)::int from ideas i where i.objective_id = o.id) as ideas,
            (select count(*)::int from campaigns c where c.objective_id = o.id) as campaigns
     from objectives o where o.workspace_id = $1 order by o.status = 'active' desc, o.weight desc, o.created_at`,
    [ws],
  )).rows;
}

export async function saveObjective(db: Db, ws: string, input: ObjectiveInput, id?: string) {
  const v = [input.title, input.period_start ?? null, input.period_end ?? null, input.segment ?? null, input.product_ids, input.motion,
    JSON.stringify(input.stage_messages), input.success_metric ?? null, input.target_value ?? null, input.current_value ?? null, input.weight, input.status];
  if (id) {
    const r = await db.query(
      `update objectives set title=$3, period_start=$4, period_end=$5, segment=$6, product_ids=$7, motion=$8, stage_messages=$9,
         success_metric=$10, target_value=$11, current_value=$12, weight=$13, status=$14 where id = $1 and workspace_id = $2 returning *`,
      [id, ws, ...v],
    );
    if (!r.rows[0]) throw new PlanError("Objective not found.");
    return r.rows[0];
  }
  return (await db.query(
    `insert into objectives (id, workspace_id, title, period_start, period_end, segment, product_ids, motion, stage_messages,
       success_metric, target_value, current_value, weight, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [newId("obj"), ws, ...v],
  )).rows[0];
}

export async function deleteObjective(db: Db, ws: string, id: string): Promise<void> {
  await db.query("delete from objectives where id = $1 and workspace_id = $2", [id, ws]);
}

const GrowthDraft = z.object({
  objectives: z.array(z.object({
    title: z.string().describe("specific and measurable, e.g. 'Win 3 new upstream operators in Nigeria via the readiness assessment'"),
    segment: z.string(),
    products: z.array(z.string()).describe("exact product names it depends on"),
    motion: z.array(z.string()).describe("the path to a sale, 2-5 short steps, e.g. assessment, pilot, contract"),
    awareness_message: z.string(), consideration_message: z.string(), decision_message: z.string(),
    success_metric: z.string(), target_value: z.number().nullable(),
    weight: z.number().describe("relative share of content, 1-10"),
  })),
});

export const GrowthAnswers = z.object({
  must_happen: z.string().max(1000).default(""),
  customers: z.string().max(1000).default(""),
  key_products: z.string().max(1000).default(""),
  path_to_sale: z.string().max(1000).default(""),
  measure: z.string().max(1000).default(""),
});

const GROWTH_ROLE = `You are a B2B and B2C growth strategist. From a business's verified knowledge and the owner's answers, propose 2-4 business development objectives for the next quarter that content can move. Each names the segment, the products it depends on (exact names), the path to a sale, one message per buyer stage, a measurable success metric with a realistic target when the answers support one (else null), and a weight for its share of content. Prefer the owner's words and priorities. Never invent facts about the business.`;

/** Drafts objectives; the user edits and saves them. Returns inputs, not saved rows. */
export async function draftGrowthPlan(db: Db, ws: string, answers: z.infer<typeof GrowthAnswers>): Promise<ObjectiveInput[]> {
  const ctx = await loadContext(db, ws);
  if (!ctx) throw new PlanError("Confirm the Brand Brain first.");
  const products = await listProducts(db, ws);
  const facts = await retrieveFacts(db, ws, { limit: 30 });
  const out = await structured({
    db, task: "plan:growth", workspaceId: ws, tier: "strategy", system: [GROWTH_ROLE, brandBrainBlock({ ...ctx.brain, name: ctx.brain.name }), HONESTY_RULES],
    content: `${renderFacts(facts)}\n\n## Products\n${products.map((p) => `- ${p.name} [${p.revenue_role ?? "unknown role"}]${p.ai_summary || p.summary ? `: ${(p.summary ?? p.ai_summary)!.slice(0, 200)}` : ""}`).join("\n")}\n\n## Owner's answers\nWhat must happen this quarter: ${answers.must_happen || "–"}\nTarget customers: ${answers.customers || "–"}\nProducts that matter most: ${answers.key_products || "–"}\nUsual path to a sale: ${answers.path_to_sale || "–"}\nHow they'll know it worked: ${answers.measure || "–"}`,
    schema: GrowthDraft, maxTokens: 3000, timeoutMs: 90_000,
  });
  const today = new Date();
  const qEnd = new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3 + 3, 0));
  return out.objectives.slice(0, 4).map((o) => ObjectiveInput.parse({
    title: o.title, segment: o.segment, period_start: today.toISOString().slice(0, 10), period_end: qEnd.toISOString().slice(0, 10),
    product_ids: o.products.map((n) => products.find((p) => p.name.toLowerCase() === n.trim().toLowerCase())?.id).filter((x): x is string => !!x),
    motion: o.motion.slice(0, 6), stage_messages: { awareness: o.awareness_message, consideration: o.consideration_message, decision: o.decision_message },
    success_metric: o.success_metric, target_value: o.target_value, weight: Math.max(1, Math.min(10, Math.round(o.weight))),
  }));
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const CAMPAIGN_GOALS = ["awareness", "leads", "sales", "launch", "event", "retention"] as const;

export const CampaignInput = z.object({
  name: z.string().min(2).max(160),
  objective_id: z.string().nullable().optional(),
  goal: z.enum(CAMPAIGN_GOALS).default("leads"),
  product_ids: z.array(z.string()).max(8).default([]),
  audience: z.string().max(600).nullable().optional(),
  key_message: z.string().max(600).nullable().optional(),
  offer: z.string().max(300).nullable().optional(),
  cta_text: z.string().max(160).nullable().optional(),
  cta_url: z.string().url().nullable().optional().or(z.literal("").transform(() => null)),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  platforms: z.array(z.string()).max(6).default([]),
  posts_per_week: z.number().int().min(1).max(14).default(3),
  phases: z.array(z.object({ name: z.string(), stage: z.string(), share: z.number() })).default([]),
  success_metric: z.string().max(200).nullable().optional(),
  target_value: z.number().nullable().optional(),
  current_value: z.number().nullable().optional(),
  knowledge_card_ids: z.array(z.string()).max(30).default([]),
  status: z.enum(["draft", "active", "done"]).default("draft"),
});
export type CampaignInput = z.infer<typeof CampaignInput>;

/** Default arc per goal: early posts build awareness, later ones remove hesitations and ask. */
export function defaultPhases(goal: string): { name: string; stage: string; share: number }[] {
  if (goal === "launch") return [
    { name: "Tease", stage: "awareness", share: 0.2 }, { name: "Launch", stage: "awareness", share: 0.2 },
    { name: "Proof", stage: "consideration", share: 0.3 }, { name: "Objections", stage: "decision", share: 0.2 }, { name: "Last call", stage: "decision", share: 0.1 },
  ];
  if (goal === "awareness") return [
    { name: "Problem", stage: "awareness", share: 0.5 }, { name: "Point of view", stage: "awareness", share: 0.3 }, { name: "Proof", stage: "consideration", share: 0.2 },
  ];
  if (goal === "event") return [
    { name: "Announce", stage: "awareness", share: 0.3 }, { name: "Why attend", stage: "consideration", share: 0.3 },
    { name: "Countdown", stage: "decision", share: 0.25 }, { name: "Recap", stage: "awareness", share: 0.15 },
  ];
  if (goal === "retention") return [
    { name: "Get more from it", stage: "consideration", share: 0.5 }, { name: "Stories", stage: "consideration", share: 0.3 }, { name: "What's new", stage: "awareness", share: 0.2 },
  ];
  return [
    { name: "Problem", stage: "awareness", share: 0.25 }, { name: "Approach", stage: "consideration", share: 0.25 },
    { name: "Proof", stage: "consideration", share: 0.25 }, { name: "Objections", stage: "decision", share: 0.15 }, { name: "Last call", stage: "decision", share: 0.1 },
  ];
}

export async function listCampaigns(db: Db, ws: string) {
  return (await db.query(
    `select c.*, c.start_date::text as start_date, c.end_date::text as end_date, c.target_value::float8 as target_value, c.current_value::float8 as current_value,
            o.title as objective_title,
            (select count(*)::int from ideas i where i.campaign_id = c.id) as ideas,
            (select count(*)::int from briefs b join ideas i on i.id = b.idea_id where i.campaign_id = c.id) as briefs,
            (select count(*)::int from published_posts p join ideas i on i.id = p.idea_id where i.campaign_id = c.id) as posts
     from campaigns c left join objectives o on o.id = c.objective_id where c.workspace_id = $1
     order by c.status = 'active' desc, c.start_date desc nulls last, c.created_at desc`,
    [ws],
  )).rows;
}

export async function saveCampaign(db: Db, ws: string, input: CampaignInput, id?: string) {
  const phases = input.phases.length ? input.phases : defaultPhases(input.goal);
  const v = [input.name, input.objective_id ?? null, input.goal, input.product_ids, input.audience ?? null, input.key_message ?? null, input.offer ?? null,
    input.cta_text ?? null, input.cta_url ?? null, input.start_date ?? null, input.end_date ?? null, input.platforms, input.posts_per_week,
    JSON.stringify(phases), input.success_metric ?? null, input.target_value ?? null, input.current_value ?? null, input.knowledge_card_ids, input.status];
  if (id) {
    const r = await db.query(
      `update campaigns set name=$3, objective_id=$4, goal=$5, product_ids=$6, audience=$7, key_message=$8, offer=$9, cta_text=$10, cta_url=$11,
         start_date=$12, end_date=$13, platforms=$14, posts_per_week=$15, phases=$16, success_metric=$17, target_value=$18, current_value=$19,
         knowledge_card_ids=$20, status=$21 where id = $1 and workspace_id = $2 returning *`,
      [id, ws, ...v],
    );
    if (!r.rows[0]) throw new PlanError("Campaign not found.");
    return r.rows[0];
  }
  return (await db.query(
    `insert into campaigns (id, workspace_id, name, objective_id, goal, product_ids, audience, key_message, offer, cta_text, cta_url, start_date,
       end_date, platforms, posts_per_week, phases, success_metric, target_value, current_value, knowledge_card_ids, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning *`,
    [newId("cpg"), ws, ...v],
  )).rows[0];
}

export async function deleteCampaign(db: Db, ws: string, id: string): Promise<void> {
  await db.query("delete from ideas where campaign_id = $1 and workspace_id = $2 and status in ('candidate', 'shortlisted')", [id, ws]);
  await db.query("delete from campaigns where id = $1 and workspace_id = $2", [id, ws]);
}

const CampaignDraft = z.object({
  name: z.string(), goal: z.enum(CAMPAIGN_GOALS), products: z.array(z.string()).describe("exact product names"),
  audience: z.string(), key_message: z.string(), offer: z.string().describe("what the audience gets, or empty"),
  cta_text: z.string(), cta_url: z.string().describe("the product page URL from the facts, or empty"),
  start_date: z.string().describe("YYYY-MM-DD"), end_date: z.string().describe("YYYY-MM-DD"),
  platforms: z.array(z.string()), posts_per_week: z.number().int(),
  success_metric: z.string(), target_value: z.number().nullable(),
  objective: z.string().describe("exact title of the growth-plan objective it serves, or empty"),
});

/** One sentence (plus the business knowledge) in, a campaign brief out. Cheap model; the user edits it. */
export async function draftCampaign(db: Db, ws: string, sentence: string, cardIds: string[] = []): Promise<CampaignInput> {
  const ctx = await loadContext(db, ws);
  if (!ctx) throw new PlanError("Confirm the Brand Brain first.");
  const products = await listProducts(db, ws);
  const facts = await retrieveFacts(db, ws, { limit: 25, cardIds });
  const today = new Date().toISOString().slice(0, 10);
  const out = await structured({
    db, task: "plan:campaign-draft", workspaceId: ws, tier: "fast",
    system: ["You turn one sentence into a social media campaign brief for a business. Use the business's real products and facts; never invent offers, prices or dates the sentence doesn't imply. Default to 3-4 weeks starting next Monday if no dates are given, and to the platforms the business uses.", brandBrainBlock({ ...ctx.brain, name: ctx.brain.name })],
    content: `Today: ${today}\nConnected platforms: ${ctx.platforms.join(", ") || "none yet"}\nObjectives: ${ctx.objectives.map((o) => o.title).join(" | ") || "none"}\nProducts: ${products.map((p) => `${p.name}${p.url ? ` <${p.url}>` : ""}`).join("; ")}\n\n${renderFacts(facts)}\n\nCampaign request: ${sentence}`,
    schema: CampaignDraft, maxTokens: 1500, timeoutMs: 40_000,
  });
  const platforms = out.platforms.map((p) => p.toLowerCase()).filter(isPlatform);
  return CampaignInput.parse({
    name: out.name, goal: out.goal,
    objective_id: ctx.objectives.find((o) => o.title.toLowerCase() === out.objective.trim().toLowerCase())?.id ?? null,
    product_ids: out.products.map((n) => products.find((p) => p.name.toLowerCase() === n.trim().toLowerCase())?.id).filter((x): x is string => !!x),
    audience: out.audience, key_message: out.key_message, offer: out.offer || null, cta_text: out.cta_text,
    cta_url: /^https?:\/\/\S+\.\S+/.test(out.cta_url) ? out.cta_url : null,
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(out.start_date) ? out.start_date : null, end_date: /^\d{4}-\d{2}-\d{2}$/.test(out.end_date) ? out.end_date : null,
    platforms: platforms.length ? platforms : ctx.platforms, posts_per_week: Math.max(1, Math.min(14, out.posts_per_week || 3)),
    success_metric: out.success_metric, target_value: out.target_value, knowledge_card_ids: cardIds, phases: defaultPhases(out.goal),
  });
}

/** Weekday patterns (0 = Monday): 3 a week is Mon/Wed/Fri, 2 is Tue/Thu. Above 5 a week, weekends are used too. */
const WEEK_PATTERNS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };

/** Posting dates across the campaign window at `perWeek` a week (at most one a day), capped. */
export function slotDates(start: string, end: string, perWeek: number, cap = 24): string[] {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (!(s <= e)) return [];
  const pattern = new Set(WEEK_PATTERNS[Math.max(1, Math.min(7, Math.round(perWeek)))]);
  const out: string[] = [];
  for (let d = new Date(s); d <= e && out.length < cap; d.setUTCDate(d.getUTCDate() + 1)) {
    if (pattern.has((d.getUTCDay() + 6) % 7)) out.push(d.toISOString().slice(0, 10));
  }
  // A window too short for the pattern still gets one post.
  return out.length ? out : [start];
}

/** Which phase each slot belongs to, by the phases' shares, in order. */
export function assignPhases(n: number, phases: { name: string; stage: string; share: number }[]): { name: string; stage: string }[] {
  const total = phases.reduce((s, p) => s + p.share, 0) || 1;
  const out: { name: string; stage: string }[] = [];
  let acc = 0;
  for (const p of phases) {
    acc += p.share / total;
    while (out.length < Math.round(acc * n)) out.push({ name: p.name, stage: p.stage });
  }
  while (out.length < n) out.push(phases[phases.length - 1] ?? { name: "Post", stage: "consideration" });
  return out;
}

const PlanSlot = IdeaCandidate.extend({ slot: z.number().int().describe("0-based slot index from the schedule") });
const PlanOutput = z.object({ ideas: z.array(PlanSlot) });

const PLAN_ROLE = `You plan a social media campaign as a sequence of specific, filmable post ideas. You get the campaign brief, a dated schedule of slots (each with a platform, a phase and a buyer stage) and the business's verified facts. Write exactly one idea per slot, in order, so the campaign builds: early slots name the problem, middle slots prove the approach, late slots remove hesitations and ask for the campaign's call to action. Every idea sells one of the campaign's products, fits its slot's stage, and cites the facts it uses by id. Vary hooks and formats across the sequence.`;

export async function planCampaign(db: Db, ws: string, id: string): Promise<{ created: number }> {
  const c = (await db.query("select *, start_date::text as start_date, end_date::text as end_date from campaigns where id = $1 and workspace_id = $2", [id, ws])).rows[0] as
    { id: string; name: string; goal: string; product_ids: string[]; audience: string | null; key_message: string | null; offer: string | null; cta_text: string | null; cta_url: string | null;
      start_date: string | null; end_date: string | null; platforms: string[]; posts_per_week: number; phases: { name: string; stage: string; share: number }[];
      knowledge_card_ids: string[]; objective_id: string | null } | undefined;
  if (!c) throw new PlanError("Campaign not found.");
  if (!c.start_date || !c.end_date) throw new PlanError("Set the campaign's start and end dates first.");
  const ctx = await loadContext(db, ws);
  if (!ctx) throw new PlanError("Confirm the Brand Brain first.");
  const dates = slotDates(c.start_date, c.end_date, c.posts_per_week);
  if (!dates.length) throw new PlanError("The end date must be after the start date.");
  const phases = assignPhases(dates.length, c.phases.length ? c.phases : defaultPhases(c.goal));
  const platforms = (c.platforms.length ? c.platforms : ctx.platforms).filter(isPlatform) as Platform[];
  const slots = dates.map((date, i) => ({ i, date, platform: platforms.length ? platforms[i % platforms.length]! : null, phase: phases[i]!.name, stage: phases[i]!.stage }));
  const products = (await listProducts(db, ws)).filter((p) => c.product_ids.includes(p.id));
  const facts = await retrieveFacts(db, ws, { productIds: c.product_ids, cardIds: c.knowledge_card_ids, limit: 30, perType: 6 });
  const planCtx: IdeationContext = { ...ctx, facts };
  const pb = platforms.length ? platforms : [...PLATFORMS];

  const out = await structured({
    db, task: "plan:campaign", workspaceId: ws, tier: "strategy",
    system: [PLAN_ROLE, brandBrainBlock({ ...ctx.brain, name: ctx.brain.name }), playbookBlock(pb), FEATURE_VOCAB, HONESTY_RULES],
    content: [
      `## Campaign: ${c.name}`,
      `Goal: ${c.goal}`, `Products: ${products.map((p) => p.name).join(", ") || "–"}`, `Audience: ${c.audience ?? "–"}`,
      `Key message: ${c.key_message ?? "–"}`, `Offer: ${c.offer ?? "–"}`, `Call to action: ${c.cta_text ?? "–"}${c.cta_url ? ` <${c.cta_url}>` : ""}`,
      "", "## Schedule (one idea per slot)", "slot | date | platform | phase | buyer stage",
      ...slots.map((s) => `${s.i} | ${s.date} | ${s.platform ?? "general"} | ${s.phase} | ${s.stage}`),
      "", renderContext(planCtx),
    ].join("\n"),
    schema: PlanOutput, maxTokens: Math.min(16_000, 900 * slots.length + 1000), timeoutMs: 170_000,
  });

  // Replace unbriefed ideas from an earlier plan; keep anything already briefed.
  await db.query("delete from ideas where campaign_id = $1 and status in ('candidate', 'shortlisted')", [c.id]);
  const valid = new Set([...facts.map((f) => f.id), ...ctx.signals.map((s) => s.id), ...ctx.questions.map((q) => q.id), ...ctx.ownPosts.map((p) => p.id), ...ctx.competitorWinners.map((w) => w.id)]);
  const est = new Map<Platform, Awaited<ReturnType<typeof loadEstimates>>>();
  for (const p of platforms) est.set(p, await loadEstimates(db, ws, p));
  const rows = out.ideas.filter((x) => slots[x.slot]).slice(0, slots.length);
  const scored = rows.map((idea) => {
    const slot = slots[idea.slot]!;
    const clean = { ...idea, funnel_stage: (["awareness", "consideration", "decision"].includes(slot.stage) ? slot.stage : idea.funnel_stage) as typeof idea.funnel_stage, evidence_ids: idea.evidence_ids.filter((e) => valid.has(e)), brand_fit: 0.8 };
    const platform = slot.platform;
    const s = scoreIdea(planCtx, clean, platform, platform ? est.get(platform) ?? null : null, 0.7);
    return { idea: clean, slot, platform, ...s };
  });
  const allScores = scored.map((s) => s.score);
  for (const s of scored) {
    const evidence = resolveEvidence(planCtx, s.idea.evidence_ids);
    const links = ideaLinks(planCtx, s.idea, evidence);
    const features = { ...toFeatures(s.idea, ctx.brain.language, ctx.products), campaign_phase: s.slot.phase };
    await db.query(
      `insert into ideas (id, workspace_id, mode, platform, title, why_now, core_idea, evidence, features, score, score_components, relative_label,
         confidence, content_type, effort, risks, slot, status, campaign_id, objective_id, product_id, campaign_phase, planned_for, grounded, expires_at)
       values ($1,$2,'campaign',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'explore','candidate',$16,$17,$18,$19,$20,$21, $20::date + 14)`,
      [newId("ide"), ws, s.platform, s.idea.title, s.idea.why_now, s.idea.core_idea, JSON.stringify(evidence), JSON.stringify(features), s.score,
        JSON.stringify(s.components), relativeLabel(s.score, allScores),
        confidenceLabel(s.evidenceN, s.platform ? ctx.postsWithResults[s.platform] ?? 0 : 0, s.outside),
        s.idea.content_type, s.idea.effort, s.idea.risks, c.id, c.objective_id ?? links.objective_id,
        links.product_id ?? (products.length === 1 ? products[0]!.id : null), s.slot.phase, s.slot.date, links.grounded],
    );
    await markUsed(db, ws, s.idea.evidence_ids);
  }
  await db.query("update campaigns set status = case when status = 'draft' then 'active' else status end where id = $1", [c.id]);
  return { created: scored.length };
}

export async function campaignIdeas(db: Db, ws: string, id: string) {
  return (await db.query(
    `select i.id as idea_id, i.title, i.why_now, i.core_idea, i.platform, i.evidence, i.score::float8 as score,
            coalesce(i.relative_label, 'middle_third') as relative, coalesce(i.confidence, 'low') as confidence, coalesce(i.content_type, '') as content_type,
            coalesce(i.effort, 'medium') as effort, i.risks, i.label, i.features, i.score_components, i.grounded, i.campaign_id, i.campaign_phase,
            i.planned_for::text as planned_for, i.status,
            (select b.id from briefs b where b.idea_id = i.id order by b.created_at desc limit 1) as brief_id
     from ideas i where i.workspace_id = $1 and i.campaign_id = $2 order by i.planned_for, i.created_at`,
    [ws, id],
  )).rows;
}

/** Results: posts that came from the campaign, against the brand's usual; by phase and stage. */
export async function campaignResults(db: Db, ws: string, id: string) {
  const posts = (await db.query(
    `select p.id, p.platform, p.published_at, p.permalink, left(p.caption, 160) as caption, i.campaign_phase as phase,
            i.features->>'funnel_stage' as stage, m.pi::float8 as pi, m.views::float8 as views
     from published_posts p join ideas i on i.id = p.idea_id left join mv_post_performance m on m.post_id = p.id
     where p.workspace_id = $1 and i.campaign_id = $2 order by p.published_at`,
    [ws, id],
  )).rows as { phase: string | null; stage: string | null; pi: number | null }[];
  const group = (key: "phase" | "stage") => {
    const m = new Map<string, number[]>();
    for (const p of posts) if (p[key] && p.pi != null) m.set(p[key]!, [...(m.get(p[key]!) ?? []), p.pi]);
    return [...m.entries()].map(([k, v]) => ({ key: k, posts: v.length, median_pi: [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]! }));
  };
  const pis = posts.map((p) => p.pi).filter((x): x is number => x != null).sort((a, b) => a - b);
  return {
    posts,
    median_pi: pis.length ? pis[Math.floor(pis.length / 2)]! : null,
    beat_usual: pis.filter((x) => x > 1).length,
    by_phase: group("phase"),
    by_stage: group("stage"),
  };
}
