import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config.js";
import { db, type Db } from "../db.js";
import { costUsd, type UsageLike } from "./pricing.js";

/**
 * The single entry point for Claude. Every call:
 *  - picks a model tier from config (fast = extraction/tagging/verdicts/adapters,
 *    strategy = ideation/critique/reports),
 *  - puts the stable prefix (Brand Brain, playbooks, schemas) first with a cache
 *    breakpoint so repeat calls read it at 10% of the input price,
 *  - returns schema-validated JSON (structured outputs),
 *  - checks the workspace's daily budget first and writes the cost log after.
 */

export type Tier = "fast" | "strategy";

export class BudgetExceededError extends Error {
  constructor(public readonly workspaceId: string, spent: number, budget: number) {
    super(`workspace ${workspaceId} spent $${spent.toFixed(4)} of its $${budget.toFixed(2)} daily Claude budget`);
  }
}

export class RefusalError extends Error {}

let client: Anthropic | undefined;
export function anthropic(): Anthropic {
  client ??= new Anthropic(config().ANTHROPIC_API_KEY ? { apiKey: config().ANTHROPIC_API_KEY } : {});
  return client;
}
/** Test hook. */
export function setAnthropic(c: Anthropic): void {
  client = c;
}

export function modelFor(tier: Tier): string {
  return tier === "fast" ? config().MODEL_FAST : config().MODEL_STRATEGY;
}

/** Haiku 4.5 takes neither adaptive thinking nor effort; newer models take both. */
function tierParams(model: string, tier: Tier): Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking"> & { effort?: "low" | "medium" | "high" } {
  if (model.startsWith("claude-haiku")) return {};
  return { thinking: { type: "adaptive" }, effort: tier === "fast" ? "low" : "medium" };
}

export interface CallContext {
  task: string;
  workspaceId: string | null;
  db?: Db;
}

export async function assertBudget(ctx: CallContext): Promise<void> {
  if (!ctx.workspaceId) return;
  const r = await (ctx.db ?? db()).query<{ spent: string }>(
    `select coalesce(sum(cost_usd), 0) as spent from cost_log
     where workspace_id = $1 and created_at >= date_trunc('day', now())`,
    [ctx.workspaceId],
  );
  const spent = Number(r.rows[0]?.spent ?? 0);
  const budget = config().WORKSPACE_DAILY_BUDGET_USD;
  if (spent >= budget) throw new BudgetExceededError(ctx.workspaceId, spent, budget);
}

export async function logCost(ctx: CallContext, model: string, usage: UsageLike, latencyMs: number | null, batch = false): Promise<void> {
  await (ctx.db ?? db()).query(
    `insert into cost_log (workspace_id, task, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, batch, cost_usd, latency_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [ctx.workspaceId, ctx.task, model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0,
      usage.cache_creation_input_tokens ?? 0, batch, costUsd(model, usage, batch), latencyMs],
  );
}

/** Stable prefix blocks; the last one carries the cache breakpoint. */
export function cachedSystem(blocks: string[]): Anthropic.TextBlockParam[] {
  return blocks.map((text, i) => ({
    type: "text" as const,
    text,
    ...(i === blocks.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

export interface StructuredRequest<S extends z.ZodType> extends CallContext {
  tier: Tier;
  system: string[];
  content: Anthropic.MessageParam["content"];
  schema: S;
  maxTokens?: number;
}

export async function structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
  await assertBudget(req);
  const model = modelFor(req.tier);
  const { effort, ...extra } = tierParams(model, req.tier);
  const started = Date.now();
  const res = await anthropic().messages.parse({
    model,
    max_tokens: req.maxTokens ?? 16000,
    system: cachedSystem(req.system),
    messages: [{ role: "user", content: req.content }],
    output_config: { format: zodOutputFormat(req.schema), ...(effort ? { effort } : {}) },
    ...extra,
  });
  await logCost(req, model, res.usage, Date.now() - started);
  if (res.stop_reason === "refusal") throw new RefusalError(`${req.task}: model declined (${res.stop_details?.category ?? "unknown"})`);
  if (res.stop_reason === "max_tokens") throw new Error(`${req.task}: output truncated at max_tokens`);
  if (res.parsed_output == null) throw new Error(`${req.task}: response did not match the schema`);
  return res.parsed_output as z.infer<S>;
}

export interface StreamRequest extends CallContext {
  tier: Tier;
  system: string[];
  content: Anthropic.MessageParam["content"];
  maxTokens?: number;
}

/** Streamed plain-text call (Refine my idea shows first words in under 2 s). */
export async function streamText(req: StreamRequest, onText: (delta: string) => void): Promise<string> {
  await assertBudget(req);
  const model = modelFor(req.tier);
  const { effort, ...extra } = tierParams(model, req.tier);
  const started = Date.now();
  const stream = anthropic().messages.stream({
    model,
    max_tokens: req.maxTokens ?? 4000,
    system: cachedSystem(req.system),
    messages: [{ role: "user", content: req.content }],
    ...(effort ? { output_config: { effort } } : {}),
    ...extra,
  });
  stream.on("text", onText);
  const final = await stream.finalMessage();
  await logCost(req, model, final.usage, Date.now() - started);
  if (final.stop_reason === "refusal") throw new RefusalError(`${req.task}: model declined`);
  return final.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
}
