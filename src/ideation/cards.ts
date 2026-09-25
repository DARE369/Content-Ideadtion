import type { Db } from "../db.js";
import type { IdeaCard } from "../contracts/idea.js";

/** "Give me ideas" is a database read of the precomputed shortlist. */
export async function shortlist(db: Db, workspaceId: string, limit = 10): Promise<IdeaCard[]> {
  const r = await db.query(
    `select id as idea_id, title, why_now, core_idea, platform, evidence, score::float8 as score,
            coalesce(relative_label, 'middle_third') as relative, coalesce(confidence, 'low') as confidence,
            coalesce(content_type, '') as content_type, coalesce(effort, 'medium') as effort, risks, label, features
     from ideas where workspace_id = $1 and status = 'shortlisted'
     order by score desc nulls last limit $2`,
    [workspaceId, limit],
  );
  return r.rows as IdeaCard[];
}

export async function ideaCard(db: Db, ideaId: string): Promise<IdeaCard | null> {
  const r = await db.query(
    `select id as idea_id, title, why_now, core_idea, platform, evidence, score::float8 as score,
            coalesce(relative_label, 'middle_third') as relative, coalesce(confidence, 'low') as confidence,
            coalesce(content_type, '') as content_type, coalesce(effort, 'medium') as effort, risks, label, features
     from ideas where id = $1`,
    [ideaId],
  );
  return (r.rows[0] as IdeaCard | undefined) ?? null;
}
