import { z } from "zod";
import { PLATFORMS } from "../types.js";

/**
 * Stage 3 (content management + scheduling) is RESERVED. These two records are
 * its whole interface: it accepts generated_asset and emits published_post.
 * Analytics depends only on published_post, so a scheduler plugs in later.
 */

export const GeneratedAsset = z.object({
  asset_id: z.string(),
  brief_id: z.string().startsWith("brf_"),
  platform: z.enum(PLATFORMS),
  media: z.array(z.object({ url: z.string().url(), kind: z.enum(["video", "image", "document", "text"]) })),
  caption: z.string(),
  scheduled_at: z.string().datetime().nullable(),
});

export const PublishedPost = z.object({
  platform_post_id: z.string().min(1),
  platform: z.enum(PLATFORMS),
  workspace_id: z.string().startsWith("wsp_"),
  connected_account_id: z.string().optional(),
  asset_id: z.string().nullable().optional(),
  // Nullable only for posts published outside the studio; those go through matching.
  brief_id: z.string().startsWith("brf_").nullable(),
  idea_id: z.string().startsWith("ide_").nullable(),
  published_at: z.string().datetime({ offset: true }),
  permalink: z.string().url().nullable().optional(),
  caption: z.string().nullable().optional(),
  duration_seconds: z.number().nonnegative().nullable().optional(),
});

export type GeneratedAsset = z.infer<typeof GeneratedAsset>;
export type PublishedPost = z.infer<typeof PublishedPost>;

/** The reserved block. Anything implementing this can be dropped in without touching analytics. */
export interface SchedulerBlock {
  accept(asset: GeneratedAsset): Promise<void>;
  onPublished(handler: (post: PublishedPost) => Promise<void>): void;
}
