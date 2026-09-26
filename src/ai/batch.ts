import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { Db } from "../db.js";
import { enqueue } from "../jobs/queue.js";
import { anthropic, cachedSystem, logCost, modelFor, type Tier } from "./client.js";

/**
 * Background work (competitor post deconstruction, vision tagging) goes through
 * the Message Batches API at 50% of standard prices. A batch is submitted, then
 * a `batch_poll` job checks it until it ends and hands each result to its handler.
 */

export interface BatchItem {
  custom_id: string;
  content: Anthropic.MessageParam["content"];
}

export const BATCH_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export async function submitBatch<S extends z.ZodType>(
  db: Db,
  opts: { task: string; handler: string; tier: Tier; system: string[]; schema: S; items: BatchItem[]; workspaceId: string | null; maxTokens?: number },
): Promise<string | null> {
  if (opts.items.length === 0) return null;
  // The Batch API only accepts these ids; fail here (and in tests), not on the live service.
  const bad = opts.items.find((it) => !BATCH_ID.test(it.custom_id));
  if (bad) throw new Error(`invalid batch custom_id "${bad.custom_id}"`);
  const model = modelFor(opts.tier);
  const format = zodOutputFormat(opts.schema);
  const batch = await anthropic().messages.batches.create({
    requests: opts.items.map((it) => ({
      custom_id: it.custom_id,
      params: {
        model,
        max_tokens: opts.maxTokens ?? 2000,
        system: cachedSystem(opts.system),
        messages: [{ role: "user" as const, content: it.content }],
        output_config: { format: { type: format.type, schema: format.schema } },
      },
    })),
  });
  await enqueue(
    db, "batch_poll",
    { batch_id: batch.id, handler: opts.handler, task: opts.task, model, workspace_id: opts.workspaceId },
    { runAt: new Date(Date.now() + 5 * 60_000), dedupeKey: `batch:${batch.id}`, maxAttempts: 200 },
  );
  return batch.id;
}

export type BatchHandler = (db: Db, customId: string, output: unknown) => Promise<void>;

/** Returns true when the batch has ended and every result was handled. */
export async function pollBatch(
  db: Db,
  payload: { batch_id: string; handler: string; task: string; model: string; workspace_id: string | null },
  handlers: Record<string, BatchHandler>,
): Promise<boolean> {
  const batch = await anthropic().messages.batches.retrieve(payload.batch_id);
  if (batch.processing_status !== "ended") return false;
  const handle = handlers[payload.handler];
  if (!handle) throw new Error(`no batch handler "${payload.handler}"`);
  for await (const r of await anthropic().messages.batches.results(payload.batch_id)) {
    if (r.result.type !== "succeeded") {
      console.warn(`[batch ${payload.batch_id}] ${r.custom_id}: ${r.result.type}`);
      continue;
    }
    const msg = r.result.message;
    await logCost({ task: payload.task, workspaceId: payload.workspace_id, db }, payload.model, msg.usage, null, true);
    const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (!text) continue;
    try {
      await handle(db, r.custom_id, JSON.parse(text));
    } catch (err) {
      console.warn(`[batch ${payload.batch_id}] ${r.custom_id}: handler failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return true;
}
