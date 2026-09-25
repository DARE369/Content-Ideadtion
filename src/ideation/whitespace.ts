import type { Db } from "../db.js";
import { jaccard, clamp01 } from "../lib/stats.js";
import { toVector } from "../lib/embed.js";

/**
 * White space (W): 1 - similarity to the nearest thing competitors (or this brand's
 * recent ideas) already covered. Uses pgvector when embeddings exist, otherwise a
 * lexical fallback, so the score works on day one either way.
 */

export const DUPLICATE_SIMILARITY = 0.9;

export async function nearestSimilarity(
  db: Db, workspaceId: string, text: string, embedding: number[] | null,
): Promise<{ competitor: number; recentIdea: number }> {
  if (embedding) {
    const v = toVector(embedding);
    const r = await db.query<{ competitor: number | null; idea: number | null }>(
      `select
         (select 1 - min(embedding <=> $2::vector) from competitor_posts where workspace_id = $1 and embedding is not null) as competitor,
         (select 1 - min(embedding <=> $2::vector) from ideas where workspace_id = $1 and embedding is not null
            and created_at > now() - interval '30 days') as idea`,
      [workspaceId, v],
    );
    return { competitor: clamp01(Number(r.rows[0]?.competitor ?? 0)), recentIdea: clamp01(Number(r.rows[0]?.idea ?? 0)) };
  }
  const comp = await db.query<{ t: string }>(
    `select concat_ws(' ', title, caption) as t from competitor_posts where workspace_id = $1 order by fetched_at desc limit 200`,
    [workspaceId],
  );
  const ideas = await db.query<{ t: string }>(
    `select concat_ws(' ', title, core_idea) as t from ideas where workspace_id = $1 and created_at > now() - interval '30 days' limit 300`,
    [workspaceId],
  );
  const best = (rows: { t: string }[]) => rows.reduce((m, r) => Math.max(m, jaccard(text, r.t)), 0);
  // Jaccard runs lower than cosine for paraphrases; scale so ~0.45 overlap reads as a near-duplicate.
  return { competitor: clamp01(best(comp.rows) * 2), recentIdea: clamp01(best(ideas.rows) * 2) };
}

export function whiteSpace(sim: { competitor: number }): number {
  return clamp01(1 - sim.competitor);
}
