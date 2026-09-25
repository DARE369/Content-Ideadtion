import { serve } from "@hono/node-server";
import { config } from "../config.js";
import { db } from "../db.js";
import { createApp } from "./app.js";

const app = createApp(db());
serve({ fetch: app.fetch, port: config().PORT }, (info) => {
  console.log(`[api] listening on :${info.port}`);
});
