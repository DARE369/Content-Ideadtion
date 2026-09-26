import type { Db } from "../db.js";
import type { IdeaCard } from "../contracts/idea.js";

const COLUMNS = `i.id as idea_id, i.title, i.why_now, i.core_idea, i.platform, i.evidence, i.score::float8 as score,
  coalesce(i.relative_label, 'middle_third') as relative, coalesce(i.confidence, 'low') as confidence,
  coalesce(i.content_type, '') as content_type, coalesce(i.effort, 'medium') as effort, i.risks, i.label, i.features, i.score_components,
  i.grounded, i.campaign_id, c.name as campaign_name, i.campaign_phase, i.planned_for::text as planned_for, o.title as objective_title`;
const JOINS = "from ideas i left join campaigns c on c.id = i.campaign_id left join objectives o on o.id = i.objective_id";

/**
 * "Give me ideas" is a database read of the precomputed shortlist, plus the
 * active campaigns' posts planned for the coming week (in date order, first).
 */
export async function shortlist(db: Db, workspaceId: string, limit = 10): Promise<IdeaCard[]> {
  const campaign = await db.query(
    `select ${COLUMNS} ${JOINS}
     where i.workspace_id = $1 and i.mode = 'campaign' and i.status in ('candidate', 'shortlisted') and c.status = 'active'
       and i.planned_for between current_date - 2 and current_date + 7
     order by i.planned_for, i.created_at limit 12`,
    [workspaceId],
  );
  const r = await db.query(
    `select ${COLUMNS} ${JOINS}
     where i.workspace_id = $1 and i.status = 'shortlisted' and i.mode <> 'campaign'
     order by i.score desc nulls last limit $2`,
    [workspaceId, limit],
  );
  return [...campaign.rows, ...r.rows] as IdeaCard[];
}

export async function ideaCard(db: Db, ideaId: string): Promise<IdeaCard | null> {
  const r = await db.query(`select ${COLUMNS} ${JOINS} where i.id = $1`, [ideaId]);
  return (r.rows[0] as IdeaCard | undefined) ?? null;
}
