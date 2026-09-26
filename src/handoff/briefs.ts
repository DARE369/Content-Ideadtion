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
}

async function loadIdea(db: Db, ideaId: string): Promise<IdeaRow> {
  const r = await db.query<IdeaRow>(
    `select id, workspace_id, title, why_now, core_idea, content_type, features, evidence, relative_label, confidence, label, risks
     from ideas where id = $1`, [ideaId],
  );
  if (!r.rows[0]) throw new Error(`idea ${ideaId} not found`);
  return r.rows[0];
}

function ideaBlock(idea: IdeaRow): string {
  return [
    `Idea: ${idea.title}`,
    `Core idea: ${idea.core_idea}`,
    `Why now: ${idea.why_now}`,
    idea.features.offer && idea.features.offer !== "brand" ? `Sells: ${idea.features.offer}` : null,
    idea.features.funnel_stage ? `Buyer stage: ${idea.features.funnel_stage}. Make the CTA fit this stage.` : null,
    `Planned features: ${Object.entries(idea.features).filter(([k]) => k !== "offer" && k !== "funnel_stage").map(([k, v]) => `${k}=${v}`).join(", ")}`,
    idea.risks.length ? `Risks to avoid: ${idea.risks.join("; ")}` : null,
  ].filter(Boolean).join("\n");
}

/** Link to the page of the product the idea sells, else any product page, else the website. */
function ctaUrl(brain: WorkspaceBrain, offer?: string): string | null {
  return brain.offers.find((o) => o.name === offer && o.url)?.url ?? brain.offers.find((o) => o.url)?.url ?? brain.website_url ?? null;
}

function common(idea: IdeaRow, brain: WorkspaceBrain, briefId: string) {
  return {
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

export async function buildPlatformBrief(db: Db, idea: IdeaRow, brain: WorkspaceBrain, platform: Platform): Promise<PlatformBrief> {
  const pb = playbook(platform);
  const out = await structured({
    db, task: `adapter:${platform}`, workspaceId: idea.workspace_id, tier: "fast",
    system: [ADAPTER_ROLE, brandBrainBlock(brain), playbookBlock([platform]), FEATURE_VOCAB, HONESTY_RULES],
    content: `${ideaBlock(idea)}\n\nWrite the ${platform} brief. Allowed formats: ${pb.formats.join(", ")}.`,
    schema: AdapterOutput,
  });
  const briefId = newId("brf");
  const format = pb.formats.includes(out.format) ? out.format : pb.default_format;
  const url = ctaUrl(brain, idea.features.offer);
  const lengths =
    out.length_seconds_min != null && out.length_seconds_max != null && pb.length_seconds
      ? ([Math.max(0, out.length_seconds_min), Math.min(out.length_seconds_max, pb.length_seconds[1])] as [number, number])
      : pb.length_seconds;
  return PlatformBrief.parse({
    ...common(idea, brain, briefId),
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
    ...(out.title ? { title: out.title } : {}),
    ...(out.thumbnail_brief ? { thumbnail_brief: out.thumbnail_brief } : {}),
    do_not: [...new Set([...pb.do_not, ...out.do_not])],
  });
}

export async function buildGeneralBrief(db: Db, idea: IdeaRow, brain: WorkspaceBrain): Promise<GeneralBrief> {
  const out = await structured({
    db, task: "adapter:general", workspaceId: idea.workspace_id, tier: "fast",
    system: [GENERAL_ROLE, brandBrainBlock(brain), FEATURE_VOCAB, HONESTY_RULES],
    content: ideaBlock(idea),
    schema: GeneralOutput,
  });
  const briefId = newId("brf");
  const url = ctaUrl(brain, idea.features.offer);
  return GeneralBrief.parse({
    ...common(idea, brain, briefId),
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

  const briefs = await Promise.all(
    (wanted.length ? wanted : [null]).map(async (platform) => {
      const draft = reuse(platform);
      if (draft) {
        await db.query("update briefs set status = 'queued' where id = $1 and status = 'draft'", [draft.id]);
        return draft.payload;
      }
      const b = platform ? await buildPlatformBrief(db, idea, brain, platform) : await buildGeneralBrief(db, idea, brain);
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
     order by (slot = 'exploit') desc, score desc nulls last limit 1`,
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
