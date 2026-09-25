import { config } from "../config.js";
import { fetchJson } from "./http.js";

/** 384-dim embeddings from the Supabase Edge Function (gte-small). Null when not configured. */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const url = config().EMBED_URL;
  if (!url || texts.length === 0) return null;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const res = await fetchJson<{ embeddings: number[][] }>(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(config().EMBED_API_KEY ? { authorization: `Bearer ${config().EMBED_API_KEY}` } : {}) },
      body: JSON.stringify({ input: texts.slice(i, i + 64) }),
      limitKey: "embed",
    });
    out.push(...res.embeddings);
  }
  return out;
}

/** pgvector literal. */
export const toVector = (v: number[] | null | undefined): string | null => (v ? `[${v.join(",")}]` : null);
