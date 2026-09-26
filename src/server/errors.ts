import Anthropic from "@anthropic-ai/sdk";
import { ConfigError } from "../config.js";

/**
 * Turn infrastructure failures into messages a person setting up the app can act
 * on. Never includes secrets: database errors don't carry the password, and
 * config errors name variables, not values.
 */
export function explain(err: unknown): string | null {
  if (err instanceof ConfigError) return err.message;
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "";
  switch (e?.code) {
    case "42P01":
    case "3F000":
      return "The database tables don't exist yet. In Supabase, run the two SQL files from supabase/migrations in the SQL Editor, in order.";
    case "28P01":
    case "28000":
      return "The database rejected the login. Check the password in DATABASE_URL (replace [YOUR-PASSWORD] with your real database password).";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "The database host in DATABASE_URL can't be found. Copy the Session pooler connection string from Supabase again.";
    case "ECONNREFUSED":
    case "ETIMEDOUT":
      return "Couldn't reach the database. Use Supabase's Session pooler connection string (port 5432 on *.pooler.supabase.com).";
    case "42883":
    case "42704":
      if (/vector/i.test(msg)) return "The pgvector extension isn't enabled. In Supabase: Database → Extensions → enable 'vector', then run the SQL files again.";
      break;
    case "XX000":
      if (/tenant|user not found/i.test(msg)) return "The database user in DATABASE_URL isn't recognised by the pooler. Copy the Session pooler string from Supabase (the user looks like postgres.yourprojectref).";
  }
  if (/password authentication failed/i.test(msg)) return "The database rejected the password in DATABASE_URL.";
  if (/self[- ]signed certificate|SSL|ssl/.test(msg) && /required|off|certificate/i.test(msg)) return `Database SSL problem: ${msg}`;
  if (/Tenant or user not found/i.test(msg)) return "The database user in DATABASE_URL isn't recognised. Copy the Session pooler string from Supabase again.";
  if (/prepared statement/i.test(msg)) return "DATABASE_URL points at Supabase's Transaction pooler (port 6543). Use the Session pooler string instead (port 5432).";
  return explainAi(err);
}

/** AI service failures, in plain words, with the service's own reason where it helps. */
function explainAi(err: unknown): string | null {
  const msg = err instanceof Error ? err.message.replace(/\s+/g, " ") : "";
  if (err instanceof Anthropic.APIConnectionTimeoutError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))) {
    return "The AI service took too long to answer. Please try again.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Please try again in a minute.";
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return "The AI service rejected the Anthropic API key. Check ANTHROPIC_API_KEY in Vercel.";
    if (err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500) return "The AI service is busy right now. Please try again in a minute.";
    if (err.status === 400) return `The AI service rejected the request: ${msg.slice(0, 240)}`;
    return `The AI service returned an error (${err.status}): ${msg.slice(0, 200)}`;
  }
  if (/output truncated at max_tokens/.test(msg)) return "The AI's answer was too long and got cut off. Please try again.";
  if (/did not match the schema|Failed to parse structured output/.test(msg)) return "The AI's answer came back incomplete, twice. Please try again; if it keeps happening, send us this: " + msg.slice(0, 160);
  return null;
}
