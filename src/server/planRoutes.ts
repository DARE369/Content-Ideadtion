import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { isTimeout } from "../ai/client.js";
import {
  CampaignInput, campaignIdeas, campaignResults, deleteCampaign, deleteObjective, draftCampaign, draftGrowthPlan, GrowthAnswers, listCampaigns,
  listObjectives, ObjectiveInput, planCampaign, PlanError, saveCampaign, saveObjective,
} from "../plan/plan.js";

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const r = schema.safeParse(await c.req.json().catch(() => ({})));
  if (!r.success) throw new HTTPException(400, { message: r.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") });
  return r.data;
}

const run = async <T>(fn: () => Promise<T>, ai = false): Promise<T> => {
  if (ai && !config().ANTHROPIC_API_KEY) throw new HTTPException(503, { message: "This needs ANTHROPIC_API_KEY on the server." });
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PlanError) throw new HTTPException(409, { message: err.message });
    if (isTimeout(err)) throw new HTTPException(503, { message: "The AI took too long this time. Try again in a minute." });
    throw err;
  }
};

/** Growth plan (objectives) and campaigns. */
export function registerPlanRoutes(app: Hono, db: Db): void {
  app.get("/v1/workspaces/:ws/objectives", async (c) => c.json({ objectives: await listObjectives(db, c.req.param("ws")) }));
  app.post("/v1/workspaces/:ws/objectives", async (c) => c.json(await run(async () => saveObjective(db, c.req.param("ws"), await body(c, ObjectiveInput)))));
  app.put("/v1/workspaces/:ws/objectives/:id", async (c) => c.json(await run(async () => saveObjective(db, c.req.param("ws"), await body(c, ObjectiveInput), c.req.param("id")))));
  app.delete("/v1/workspaces/:ws/objectives/:id", async (c) => {
    await deleteObjective(db, c.req.param("ws"), c.req.param("id"));
    return c.json({ ok: true });
  });
  /** Draft 2-4 objectives from the knowledge and 5 answers. Nothing is saved until the user saves. */
  app.post("/v1/workspaces/:ws/growth-plan/draft", async (c) =>
    c.json({ objectives: await run(async () => draftGrowthPlan(db, c.req.param("ws"), await body(c, GrowthAnswers)), true) }));

  app.get("/v1/workspaces/:ws/campaigns", async (c) => c.json({ campaigns: await listCampaigns(db, c.req.param("ws")) }));
  app.get("/v1/workspaces/:ws/campaigns/:id", async (c) => {
    const ws = c.req.param("ws");
    const campaign = (await listCampaigns(db, ws)).find((x) => x.id === c.req.param("id"));
    if (!campaign) throw new HTTPException(404, { message: "campaign not found" });
    return c.json({ campaign, ideas: await campaignIdeas(db, ws, campaign.id), results: await campaignResults(db, ws, campaign.id) });
  });
  app.post("/v1/workspaces/:ws/campaigns/draft", async (c) => {
    const b = await body(c, z.object({ sentence: z.string().min(5).max(1000), card_ids: z.array(z.string()).max(30).default([]) }));
    return c.json({ campaign: await run(() => draftCampaign(db, c.req.param("ws"), b.sentence, b.card_ids), true) });
  });
  app.post("/v1/workspaces/:ws/campaigns", async (c) => c.json(await run(async () => saveCampaign(db, c.req.param("ws"), await body(c, CampaignInput)))));
  app.put("/v1/workspaces/:ws/campaigns/:id", async (c) => c.json(await run(async () => saveCampaign(db, c.req.param("ws"), await body(c, CampaignInput), c.req.param("id")))));
  app.delete("/v1/workspaces/:ws/campaigns/:id", async (c) => {
    await deleteCampaign(db, c.req.param("ws"), c.req.param("id"));
    return c.json({ ok: true });
  });
  /** Turn the campaign into a dated, phased sequence of ideas (one strategy call). */
  app.post("/v1/workspaces/:ws/campaigns/:id/plan", async (c) => c.json(await run(() => planCampaign(db, c.req.param("ws"), c.req.param("id")), true)));
}
