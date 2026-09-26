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
  return null;
}
