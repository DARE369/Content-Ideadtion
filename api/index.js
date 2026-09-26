// Vercel entry point: API paths are rewritten here (see vercel.json).
// The TypeScript is compiled to dist/ by `npm run vercel-build` first.
import { handle } from "hono/vercel";
import { db } from "../dist/src/db.js";
import { ensureSchema } from "../dist/src/schema.js";
import { createApp } from "../dist/src/server/app.js";

// Built on first request, so a bad setting becomes a readable JSON error instead of a crashed function.
let handler;
function getHandler() {
  handler ??= handle(createApp(db()));
  return handler;
}

async function entry(request) {
  try {
    // Apply any pending database migrations once per cold start.
    await ensureSchema(db());
    return await getHandler()(request);
  } catch (err) {
    console.error(err);
    const { explain } = await import("../dist/src/server/errors.js");
    return Response.json(
      { error: explain(err) ?? (err instanceof Error ? err.message : "The server failed to start.") },
      { status: 503 },
    );
  }
}

export const GET = entry;
export const POST = entry;
export const PUT = entry;
export const PATCH = entry;
export const DELETE = entry;
export const OPTIONS = entry;
