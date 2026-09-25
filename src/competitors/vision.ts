import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db.js";
import { submitBatch, type BatchHandler } from "../ai/batch.js";
import { FEATURE_VOCAB } from "../ai/prompts/shared.js";
import { VISION_ROLE, VisionTags } from "../ai/prompts/reports.js";
import { embed, toVector } from "../lib/embed.js";

/**
 * Nightly, batched (50% price): tag new competitor winners from their thumbnail or
 * cover frame plus caption/title with Claude vision, so hook analysis works
 * without transcripts. Also embeds them for white-space scoring.
 */
export async function tagCompetitorPosts(db: Db, workspaceId: string, limit = 40): Promise<string | null> {
  const posts = await db.query<{ id: string; platform: string; title: string | null; caption: string | null; thumbnail_url: string | null }>(
    `select id, platform, title, left(caption, 1000) as caption, thumbnail_url from competitor_posts
     where workspace_id = $1 and vision_tags is null and outlier_ratio >= 1.5
     order by outlier_ratio desc limit $2`,
    [workspaceId, limit],
  );
  if (posts.rows.length === 0) return null;

  const vecs = await embed(posts.rows.map((p) => `${p.title ?? ""} ${p.caption ?? ""}`.trim())).catch(() => null);
  if (vecs) {
    for (const [i, p] of posts.rows.entries()) {
      await db.query("update competitor_posts set embedding = $2::vector where id = $1", [p.id, toVector(vecs[i])]);
    }
  }

  return submitBatch(db, {
    task: "vision:tag", handler: "vision_tags", tier: "fast", workspaceId,
    system: [VISION_ROLE, FEATURE_VOCAB],
    schema: VisionTags,
    items: posts.rows.map((p) => {
      const content: Anthropic.ContentBlockParam[] = [];
      if (p.thumbnail_url) content.push({ type: "image", source: { type: "url", url: p.thumbnail_url } });
      content.push({ type: "text", text: `Platform: ${p.platform}\nTitle: ${p.title ?? "–"}\nCaption: ${p.caption ?? "–"}` });
      return { custom_id: p.id, content };
    }),
  });
}

export const visionTagsHandler: BatchHandler = async (db, customId, output) => {
  const tags = VisionTags.parse(output);
  await db.query("update competitor_posts set vision_tags = $2 where id = $1", [customId, JSON.stringify(tags)]);
};
