import type { Db } from "../db.js";
import { jaccard } from "../lib/stats.js";

/**
 * Posts published outside the studio carry no brief_id. They are matched to
 * recent briefs by platform, time window and caption similarity; the user
 * confirms the match before it counts as linked.
 */

export const MATCH_WINDOW_DAYS = 14;
export const SUGGEST_THRESHOLD = 0.3;

export interface BriefCandidate {
  brief_id: string;
  idea_id: string;
  platform: string | null;
  created_at: Date;
  text: string; // caption + hooks + core idea
}

export function scoreCandidates(caption: string, candidates: BriefCandidate[]): { brief_id: string; idea_id: string; score: number }[] {
  return candidates
    .map((c) => ({ brief_id: c.brief_id, idea_id: c.idea_id, score: jaccard(caption, c.text) }))
    .sort((a, b) => b.score - a.score);
}

export async function suggestMatch(
  db: Db,
  workspaceId: string,
  platform: string,
  publishedAt: Date,
  caption: string | null,
): Promise<{ brief_id: string; idea_id: string; score: number } | null> {
  if (!caption) return null;
  const res = await db.query<BriefCandidate>(
    `select b.id as brief_id, b.idea_id, b.platform, b.created_at,
            concat_ws(' ', b.payload->>'caption', b.payload->>'core_idea', b.payload->'hooks'->>0,
                      b.payload->'hooks'->>1, b.payload->'hooks'->>2, b.payload->>'title') as text
     from briefs b
     where b.workspace_id = $1 and (b.platform = $2 or b.kind = 'general')
       and b.created_at between $3::timestamptz - make_interval(days => $4) and $3::timestamptz
       and not exists (select 1 from published_posts p where p.brief_id = b.id and p.platform = $2)`,
    [workspaceId, platform, publishedAt, MATCH_WINDOW_DAYS],
  );
  const best = scoreCandidates(caption, res.rows)[0];
  return best && best.score >= SUGGEST_THRESHOLD ? best : null;
}
