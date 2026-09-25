// Vercel entry point: every request is rewritten here (see vercel.json).
// The TypeScript is compiled to dist/ by `npm run vercel-build` first.
import { handle } from "hono/vercel";
import { db } from "../dist/src/db.js";
import { createApp } from "../dist/src/server/app.js";

const app = createApp(db());
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
