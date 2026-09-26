import type { Db } from "../db.js";
import { structured } from "../ai/client.js";
import { ADAPTER_ROLE, AdapterOutput, GENERAL_ROLE, GeneralOutput } from "../ai/prompts/briefs.js";
import { FEATURE_VOCAB, HONESTY_RULES, brandBrainBlock, playbookBlock } from "../ai/prompts/shared.js";
import { Brief, GeneralBrief, PlatformBrief } from "../contracts/brief.js";
import { newId } from "../lib/ids.js";
import { aspectRatioFor, playbook } from "../playbooks/index.js";
import { loadBrain, type WorkspaceBrain } from "../ideation/context.js";
import { enqueue } from "../jobs/queue.js";
import { config } from "../config.js";
import { postSigned } from "./webhook.js";
import { withUtm } from "./utm.js";
import { PLATFORMS, isPlatform, type Platform } from "../types.js";
import { retrieveFacts, type KnowledgeFact } from "../knowledge/retrieve.js";
import { finalizeOptimization, optimizationFeatures, optimizationRules, unverifiedFigures, youtubeKeywordCheck } from "../optimize/optimize.js";

/**
 * Stage 2: handoff. Platforms selected -> one platform brief each, rebuilt natively
 * by that platform's adapter (run in parallel). No platform -> one general brief.
 */

interface IdeaRow {
  id: string;
  workspace_id: string;
  title: string;
  why_now: string;
  core_idea: string;
  content_type: string | null;
  features: Record<string, string>;
  evidence: { id: string }[];
  relative_label: "top_third" | "middle_third" | "bottom_third" | null;
  confidence: "low" | "medium" | "high" | null;
  label: "proven" | "test";
  risks: string[];
  product_id: string | null;
  campaign_id: string | null;
  campaign_phase: string | null;
}

async function loadIdea(db: Db, ideaId: string): Promise<IdeaRow> {
  const r = await db.query<IdeaRow>(
    `select id, workspace_id, title, why_now, core_idea, content_type, features, evidence, relative_label, confidence, label, risks,
            product_id, campaign_id, campaign_phase
     from ideas where id = $1`, [ideaId],
  );
  if (!r.rows[0]) throw new Error(`idea ${ideaId} not found`);
  return r.rows[0];
}

/** What a brief needs beyond the idea: the product, the campaign, and the verified facts to use. */
export interface BriefExtras {
  product: { name: string; url: string | null } | null;
  campaign: { id: string; name: string; phase: string | null; objective: string | null; key_message: string | null; offer: string | null; cta_text: string | null; cta_url: string | null } | null;
  facts: KnowledgeFact[];
  allowedText: string;
}

export async function briefExtras(db: Db, idea: IdeaRow, brain: WorkspaceBrain): Promise<BriefExtras> {
  const p = idea.product_id
    ? (await db.query<{ name: string; url: string | null }>("select name, url from products where id = $1", [idea.product_id])).rows[0] ?? null
    : null;
  const offer = !p && idea.features.offer && idea.features.offer !== "brand" ? brain.offers.find((o) => o.name === idea.features.offer) : undefined;
  const product = p ?? (offer ? { name: offer.name, url: offer.url ?? null } : null);
  const c = idea.campaign_id
    ? (await db.query<{ id: string; name: string; key_message: string | null; offer: string | null; cta_text: string | null; cta_url: string | null; objective: string | null }>(
        "select c.id, c.name, c.key_message, c.offer, c.cta_text, c.cta_url, o.title as objective from campaigns c left join objectives o on o.id = c.objective_id where c.id = $1",
        [idea.campaign_id],
      )).rows[0] ?? null
    : null;
  const cited = idea.evidence.map((e) => e.id).filter((id) => id.startsWith("kc_"));
  const facts = await retrieveFacts(db, idea.workspace_id, { productIds: idea.product_id ? [idea.product_id] : [], cardIds: cited, limit: 12, perType: 3 }).catch(() => [] as KnowledgeFact[]);
  const allowedText = [
    idea.title, idea.core_idea, idea.why_now, ...(idea.evidence as { summary?: string }[]).map((e) => e.summary ?? ""),
    ...facts.map((f) => `${f.title} ${f.body}`), ...brain.offers.map((o) => `${o.name} ${o.price ?? ""} ${o.description ?? ""}`),
    c ? `${c.key_message ?? ""} ${c.offer ?? ""} ${c.cta_text ?? ""}` : "", brain.description ?? "",
  ].join("\n");
  return { product, campaign: c ? { ...c, phase: idea.campaign_phase } : null, facts, allowedText };
}

function ideaBlock(idea: IdeaRow, x?: BriefExtras): string {
  return [
    `Idea: ${idea.title}`,
    `Core idea: ${idea.core_idea}`,
    `Why now: ${idea.why_now}`,
    idea.features.offer && idea.features.offer !== "brand" ? `Sells: ${idea.features.offer}` : null,
    idea.features.funnel_stage ? `Buyer stage: ${idea.features.funnel_stage}. Make the CTA fit this stage.` : null,
    `Planned features: ${Object.entries(idea.features).filter(([k]) => k !== "offer" && k !== "funnel_stage").map(([k, v]) => `${k}=${v}`).join(", ")}`,
    idea.risks.length ? `Risks to avoid: ${idea.risks.join("; ")}` : null,
    x?.campaign ? `Campaign: ${x.campaign.name}${x.campaign.phase ? ` (phase: ${x.campaign.phase})` : ""}${x.campaign.key_message ? `. Key message: ${x.campaign.key_message}` : ""}${x.campaign.offer ? `. Offer: ${x.campaign.offer}` : ""}${x.campaign.cta_text ? `. Call to action: ${x.campaign.cta_text}` : ""}` : null,
    x?.facts.length ? `Verified facts you may use (and the only source for numbers):\n${x.facts.map((f) => `- ${f.product ? `[${f.product}] ` : ""}${f.title}: ${f.body.replace(/\s+/g, " ").slice(0, 220)}`).join("\n")}` : null,
  ].filter(Boolean).join("\n");
}

/** Link to the page of the product the idea sells, else any product page, else the website. */
function ctaUrl(brain: WorkspaceBrain, offer?: string): string | null {
  return brain.offers.find((o) => o.name === offer && o.url)?.url ?? brain.offers.find((o) => o.url)?.url ?? brain.website_url ?? null;
}

function common(idea: IdeaRow, brain: WorkspaceBrain, briefId: string, x?: BriefExtras) {
  const stage = idea.features.funnel_stage;
  return {
    ...(x?.product ? { product: x.product } : {}),
    ...(x?.campaign ? { campaign: { id: x.campaign.id, name: x.campaign.name, phase: x.campaign.phase, objective: x.campaign.objective } } : {}),
    ...(stage === "awareness" || stage === "consideration" || stage === "decision" ? { buyer_stage: stage } : {}),
    ...(x?.facts.length ? { facts: x.facts.map((f) => ({ id: f.id, text: `${f.title}: ${f.body}`.slice(0, 300), url: f.url })) } : {}),
    schema: "brief.v1" as const,
    brief_id: briefId,
    idea_id: idea.id,
    workspace_id: idea.workspace_id,
    language: brain.language,
    goal: brain.goal,
    core_idea: idea.core_idea,
    evidence_ids: idea.evidence.map((e) => e.id),
    score: { relative: idea.relative_label ?? "middle_third", confidence: idea.confidence ?? "low" },
    label: idea.label,
    created_at: new Date().toISOString(),
  };
}

const LINK_CTAS = new Set(["link_in_bio", "link"]);

export async function buildPlatformBrief(db: Db, idea: IdeaRow, brain: WorkspaceBrain, platform: Platform, extras?: BriefExtras): Promise<PlatformBrief> {
  const pb = playbook(platform);
  const x = extras ?? await briefExtras(db, idea, brain);
  const out = await structured({
    db, task: `adapter:${platform}`, workspaceId: idea.workspace_id, tier: "fast",
    system: [ADAPTER_ROLE, brandBrainBlock(brain), playbookBlock([platform]), FEATURE_VOCAB, HONESTY_RULES],
    content: `${ideaBlock(idea, x)}\n\n${optimizationRules(platform)}\n\nWrite the ${platform} brief. Allowed formats: ${pb.formats.join(", ")}.`,
    schema: AdapterOutput,
  });
  const briefId = newId("brf");
  const format = pb.formats.includes(out.format) ? out.format : pb.default_format;
  const url = x.campaign?.cta_url ?? x.product?.url ?? ctaUrl(brain, idea.features.offer);
  const lengths =
    out.length_seconds_min != null && out.length_seconds_max != null && pb.length_seconds
      ? ([Math.max(0, out.length_seconds_min), Math.min(out.length_seconds_max, pb.length_seconds[1])] as [number, number])
      : pb.length_seconds;
  const brandColors = brain.brand_kit.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  const optimization = finalizeOptimization(platform, out.optimization ?? EMPTY_OPTIMIZATION, { brandColors, lengthSeconds: lengths?.[1] ?? null });
  if (platform === "youtube") {
    optimization.keyword_check = await youtubeKeywordCheck(db, optimization.primary_keyword, brain.country ?? brain.trends_geo, brain.language).catch(() => null);
  }
  const reviewNotes = figureNotes(
    [out.hooks.join(" "), out.script_or_copy, out.caption, ...out.structure.map((b) => `${b.on_screen_text ?? ""} ${b.voiceover ?? ""}`), ...(optimization.titles ?? []), optimization.description ?? ""].join("\n"),
    x.allowedText,
  );
  await db.query("update ideas set features = features || $2::jsonb where id = $1", [idea.id, JSON.stringify(optimizationFeatures(optimization))]);
  return PlatformBrief.parse({
    ...common(idea, brain, briefId, x),
    kind: "platform",
    platform,
    format,
    hooks: out.hooks.slice(0, 3),
    structure: out.structure,
    visual_direction: { style: out.visual_direction.style, brand_colors: brain.brand_kit.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)), shots: out.visual_direction.shots },
    script_or_copy: out.script_or_copy,
    caption: out.caption,
    cta: {
      type: out.cta.type,
      text: out.cta.text,
      ...(LINK_CTAS.has(out.cta.type) && url ? { url: withUtm(url, { platform, briefId, ideaId: idea.id }) } : {}),
    },
    length_seconds: lengths,
    aspect_ratio: aspectRatioFor(pb, format),
    ...((optimization.titles?.[0] ?? out.title) ? { title: optimization.titles?.[0] ?? out.title } : {}),
    ...((out.thumbnail_brief || optimization.thumbnails?.[0]) ? { thumbnail_brief: out.thumbnail_brief || `${optimization.thumbnails![0]!.concept} — text: "${optimization.thumbnails![0]!.text}"` } : {}),
    optimization,
    ...(reviewNotes.length ? { review_notes: reviewNotes } : {}),
    do_not: [...new Set([...pb.do_not, ...out.do_not])],
  });
}

const EMPTY_OPTIMIZATION: AdapterOutput["optimization"] = {
  primary_keyword: "", secondary_keywords: [], titles: [], title_style: "statement", description: "", chapters: [], thumbnails: [],
  thumbnail_style: "scene", caption_first_line: "", on_screen_text: [], spoken_keyword_line: "", alt_text: "", hashtags: [], misspelling_tags: [],
};

/** Figures the brief uses that its sources don't contain: flagged for a human, never silently kept. */
function figureNotes(text: string, allowed: string): string[] {
  return unverifiedFigures(text, allowed).slice(0, 6).map((f) => `Check "${f}": it isn't in your knowledge or this idea's evidence. Confirm it or remove it before publishing.`);
}

export async function buildGeneralBrief(db: Db, idea: IdeaRow, brain: WorkspaceBrain, extras?: BriefExtras): Promise<GeneralBrief> {
  const x = extras ?? await briefExtras(db, idea, brain);
  const out = await structured({
    db, task: "adapter:general", workspaceId: idea.workspace_id, tier: "fast",
    system: [GENERAL_ROLE, brandBrainBlock(brain), FEATURE_VOCAB, HONESTY_RULES],
    content: ideaBlock(idea, x),
    schema: GeneralOutput,
  });
  const briefId = newId("brf");
  const url = x.campaign?.cta_url ?? x.product?.url ?? ctaUrl(brain, idea.features.offer);
  const reviewNotes = figureNotes([out.hooks.join(" "), out.messaging.join(" "), out.caption].join("\n"), x.allowedText);
  return GeneralBrief.parse({
    ...common(idea, brain, briefId, x),
    ...(reviewNotes.length ? { review_notes: reviewNotes } : {}),
    kind: "general",
    hooks: out.hooks.slice(0, 3),
    messaging: out.messaging,
    visual_direction: { style: out.visual_direction.style, brand_colors: brain.brand_kit.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)), shots: out.visual_direction.shots },
    caption: out.caption,
    cta: {
      type: out.cta.type,
      text: out.cta.text,
      ...(LINK_CTAS.has(out.cta.type) && url ? { url: withUtm(url, { platform: "general", briefId, ideaId: idea.id }) } : {}),
    },
    suggested_formats: out.suggested_formats,
    do_not: out.do_not,
  });
}

async function insertBrief(db: Db, brief: Brief, status: "draft" | "queued"): Promise<void> {
  await db.query(
    `insert into briefs (id, idea_id, workspace_id, kind, platform, payload, status) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (id) do nothing`,
    [brief.brief_id, brief.idea_id, brief.workspace_id, brief.kind, brief.kind === "platform" ? brief.platform : null, JSON.stringify(brief), status],
  );
}

/**
 * Send briefs for an idea to the studio. Existing drafts for the same idea and
 * platform are reused (that is what makes Autopilot fast). Adapters run in parallel.
 */
export async function handOff(db: Db, ideaId: string, platforms: string[]): Promise<Brief[]> {
  const idea = await loadIdea(db, ideaId);
  const brain = await loadBrain(db, idea.workspace_id);
  if (!brain) throw new Error(`workspace ${idea.workspace_id} has no confirmed Brand Brain`);
  const wanted = [...new Set(platforms)].filter(isPlatform);
  if (platforms.length && wanted.length !== new Set(platforms).size) throw new Error(`unknown platform in ${platforms.join(", ")}; expected ${PLATFORMS.join(", ")}`);

  const drafts = await db.query<{ id: string; platform: string | null; kind: string; payload: Brief }>(
    `select id, platform, kind, payload from briefs where idea_id = $1 and status = 'draft'`, [ideaId],
  );
  const reuse = (p: Platform | null) => drafts.rows.find((d) => (p ? d.platform === p : d.kind === "general"));

  const extras = await briefExtras(db, idea, brain);
  const briefs = await Promise.all(
    (wanted.length ? wanted : [null]).map(async (platform) => {
      const draft = reuse(platform);
      if (draft) {
        await db.query("update briefs set status = 'queued' where id = $1 and status = 'draft'", [draft.id]);
        return draft.payload;
      }
      const b = platform ? await buildPlatformBrief(db, idea, brain, platform, extras) : await buildGeneralBrief(db, idea, brain, extras);
      await insertBrief(db, b, "queued");
      return b;
    }),
  );
  await db.query("update ideas set status = 'selected' where id = $1 and status in ('candidate', 'shortlisted')", [ideaId]);
  if (config().STUDIO_WEBHOOK_URL) {
    for (const b of briefs) await enqueue(db, "deliver_brief", { brief_id: b.brief_id }, { dedupeKey: `deliver:${b.brief_id}` });
  }
  return briefs;
}

/** The top shortlisted idea for a platform: proven first, then by score. */
export async function topIdeaFor(db: Db, workspaceId: string, platform: Platform): Promise<string | null> {
  const r = await db.query<{ id: string }>(
    `select id from ideas where workspace_id = $1 and platform = $2 and status = 'shortlisted'
     order by (slot = 'exploit') desc, score desc nulls last, id limit 1`,
    [workspaceId, platform],
  );
  return r.rows[0]?.id ?? null;
}

/** Nightly: pre-render Autopilot briefs as drafts the studio cannot see yet. */
export async function prepareDraftBriefs(db: Db, workspaceId: string, platforms: Platform[]): Promise<number> {
  const brain = await loadBrain(db, workspaceId);
  if (!brain) return 0;
  const jobs = await Promise.all(platforms.map(async (p) => {
    const ideaId = await topIdeaFor(db, workspaceId, p);
    if (!ideaId) return 0;
    const exists = await db.query("select 1 from briefs where idea_id = $1 and platform = $2", [ideaId, p]);
    if (exists.rowCount) return 0;
    await insertBrief(db, await buildPlatformBrief(db, await loadIdea(db, ideaId), brain, p), "draft");
    return 1;
  }));
  return jobs.reduce<number>((a, b) => a + b, 0);
}

/** Autopilot: one tap queues this week's top idea per connected platform. */
export async function autopilot(db: Db, workspaceId: string, platforms: Platform[]): Promise<Brief[]> {
  const out: Brief[] = [];
  const results = await Promise.all(platforms.map(async (p) => {
    const ideaId = await topIdeaFor(db, workspaceId, p);
    return ideaId ? handOff(db, ideaId, [p]) : [];
  }));
  for (const r of results) out.push(...r);
  return out;
}

/** Worker job: push one queued brief to the studio webhook. */
export async function deliverBrief(db: Db, briefId: string): Promise<void> {
  const { STUDIO_WEBHOOK_URL: url, STUDIO_WEBHOOK_SECRET: secret } = config();
  if (!url || !secret) return;
  const r = await db.query<{ payload: Brief; status: string }>("select payload, status from briefs where id = $1", [briefId]);
  const row = r.rows[0];
  if (!row || row.status === "delivered" || row.status === "acknowledged") return;
  const res = await postSigned(url, secret, briefId, row.payload);
  if (!res.ok) {
    await db.query("update briefs set attempts = attempts + 1, last_error = $2, status = 'failed' where id = $1", [briefId, `HTTP ${res.status}`]);
    throw new Error(`studio webhook returned ${res.status}`);
  }
  await db.query("update briefs set status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_error = null where id = $1", [briefId]);
}
