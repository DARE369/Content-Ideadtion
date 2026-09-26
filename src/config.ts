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
  /** Supabase Storage for uploaded originals (free tier). Server-only; never sent to the browser. */
  SUPABASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  UPLOAD_BUCKET: z.string().default("ideation-uploads"),
  META_GRAPH_VERSION: z.string().default("v23.0"),
  LINKEDIN_VERSION: z.string().default("202509"),
  PORT: z.coerce.number().int().default(8787),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  CRON_SECRET: z.string().optional(),
  /** "open" lets the web app call /v1 without a token. Temporary until user auth exists. */
  AUTH_MODE: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["token", "open"])).default("token"),
});

export type Config = z.infer<typeof Env>;

let cached: Config | undefined;

/** A setting that can't be read. The message names the variable, never its value. */
export class ConfigError extends Error {}

/** Dashboards make it easy to paste stray spaces or quotes; ignore them, and treat empty as unset. */
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(env)) {
    if (raw === undefined) continue;
    const v = raw.trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (v !== "") out[k] = v;
  }
  return out;
}

export function config(): Config {
  if (!cached) {
    const r = Env.safeParse(cleanEnv(process.env));
    if (!r.success) {
      const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
      throw new ConfigError(`These environment variables have values the app can't use: ${names.join(", ")}. Check them in your hosting settings.`);
    }
    cached = r.data;
  }
  return cached;
}

/** Test hook: reset the memoised config after mutating process.env. */
export function resetConfig(): void {
  cached = undefined;
}
