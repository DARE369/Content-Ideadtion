import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/postgres"),
  ANTHROPIC_API_KEY: z.string().optional(),
  MODEL_FAST: z.string().default("claude-haiku-4-5"),
  MODEL_STRATEGY: z.string().default("claude-sonnet-5"),
  WORKSPACE_DAILY_BUDGET_USD: z.coerce.number().positive().default(1),
  YOUTUBE_API_KEY: z.string().optional(),
  HTTP_USER_AGENT: z.string().default("ContentIdeationEngine/0.1 (set HTTP_USER_AGENT)"),
  STUDIO_WEBHOOK_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  STUDIO_WEBHOOK_SECRET: z.string().optional(),
  API_TOKEN: z.string().optional(),
  STUDIO_TOKEN_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  STUDIO_API_TOKEN: z.string().optional(),
  EMBED_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  EMBED_API_KEY: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v23.0"),
  LINKEDIN_VERSION: z.string().default("202509"),
  PORT: z.coerce.number().int().default(8787),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

export function config(): Config {
  cached ??= Env.parse(process.env);
  return cached;
}

/** Test hook: reset the memoised config after mutating process.env. */
export function resetConfig(): void {
  cached = undefined;
}
