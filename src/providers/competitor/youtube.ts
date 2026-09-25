import { config } from "../../config.js";
import { cached } from "../../lib/cache.js";
import { fetchJson } from "../../lib/http.js";
import { db } from "../../db.js";
import { parseIsoDuration } from "../own/youtube.js";
import type { CompetitorPostRecord, CompetitorProvider } from "../types.js";

/**
 * Public YouTube data with the project API key. Uses the uploads playlist
 * (1 unit per call) rather than search (100 units).
 */

const DATA = "https://www.googleapis.com/youtube/v3";

function key(): string {
  const k = config().YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY is not set");
  return k;
}

const q = <T>(path: string) => fetchJson<T>(`${DATA}${path}&key=${key()}`, { limitKey: "youtube_quota", cost: 1 });

interface VideoItem {
  id: string;
  snippet: { title: string; description: string; publishedAt: string; tags?: string[]; thumbnails?: Record<string, { url: string }> };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration: string };
}

export function mapVideos(items: VideoItem[]): CompetitorPostRecord[] {
  return items.map((v) => {
    const t = v.snippet.thumbnails ?? {};
    const secs = parseIsoDuration(v.contentDetails?.duration);
    return {
      platform: "youtube",
      platform_post_id: v.id,
      permalink: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.snippet.title,
      caption: v.snippet.description,
      thumbnail_url: (t.high ?? t.medium ?? t.default)?.url ?? null,
      media_type: secs != null && secs <= 180 ? "short" : "long_form",
      published_at: v.snippet.publishedAt,
      views: v.statistics.viewCount != null ? Number(v.statistics.viewCount) : null,
      likes: v.statistics.likeCount != null ? Number(v.statistics.likeCount) : null,
      comments: v.statistics.commentCount != null ? Number(v.statistics.commentCount) : null,
      source_url: `https://www.youtube.com/watch?v=${v.id}`,
    };
  });
}

/** Accepts a channel id (UC...) or an @handle. */
async function uploadsPlaylist(channel: string): Promise<string | null> {
  const filter = channel.startsWith("UC") ? `id=${channel}` : `forHandle=${encodeURIComponent(channel.replace(/^@?/, "@"))}`;
  const res = await cached(db(), "youtube", `yt:uploads:${channel}`, 30 * 86400, () =>
    q<{ items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[] }>(`/channels?part=contentDetails&${filter}`),
  );
  return res.items?.[0]?.contentDetails.relatedPlaylists.uploads ?? null;
}

export class YouTubeCompetitorProvider implements CompetitorProvider {
  readonly platform = "youtube" as const;

  async recentPosts(channel: string): Promise<CompetitorPostRecord[]> {
    const uploads = await uploadsPlaylist(channel);
    if (!uploads) return [];
    const pl = await q<{ items: { contentDetails: { videoId: string } }[] }>(
      `/playlistItems?part=contentDetails&maxResults=30&playlistId=${uploads}`,
    );
    const ids = pl.items.map((i) => i.contentDetails.videoId);
    if (ids.length === 0) return [];
    const vids = await q<{ items: VideoItem[] }>(`/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}`);
    return mapVideos(vids.items);
  }
}
