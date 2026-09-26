import { z } from "zod";
import type { Db } from "../db.js";
import { config } from "../config.js";
import { bucketFor, fetchJson } from "../lib/http.js";
import type { Platform } from "../types.js";

/**
 * Platform optimisation for briefs, following the platforms' own guidance:
 * - YouTube ranks on title, description and video content, then engagement; tags play a
 *   minimal role (misspellings only). 90% of best-performing videos use custom thumbnails
 *   (1280x720, 16:9, <= 2 MB). Test & Compare tries up to 3 titles/thumbnails and picks by
 *   watch-time share, so every YouTube brief ships 3 variants. Chapters: first 00:00, >= 3,
 *   each >= 10 s.
 * - Instagram and TikTok read caption keywords, on-screen text and spoken words; hashtags
 *   classify rather than drive reach, so they are capped.
 * Sources are listed in docs/WEEK2_SPEC.md §12.
 */

export const TITLE_STYLES = ["question", "number", "how_to", "statement", "contrarian", "story"] as const;
export const THUMBNAIL_STYLES = ["face", "product", "text_heavy", "before_after", "diagram", "scene"] as const;

/** What the model writes (part of the adapter output). */
export const OptimizationDraft = z.object({
  primary_keyword: z.string().describe("the phrase a buyer would type into the platform's search"),
  secondary_keywords: z.array(z.string()).describe("2-4 related phrases"),
  titles: z.array(z.string()).describe("YouTube: 3 distinct title options, keyword early, a promise the video keeps; empty elsewhere"),
  title_style: z.enum(TITLE_STYLES),
  description: z.string().describe("YouTube: first two lines carry the keyword and the promise; then the link and context; empty elsewhere"),
  chapters: z.array(z.object({ t: z.string().describe("mm:ss"), title: z.string() })).describe("YouTube videos over 60 s: first 00:00, at least 3, each at least 10 s; empty otherwise"),
  thumbnails: z.array(z.object({
    concept: z.string(), text: z.string().describe("4 words or fewer"), subject: z.string(), layout: z.string(),
  })).describe("YouTube: 3 distinct concepts for Test & Compare; empty elsewhere"),
  thumbnail_style: z.enum(THUMBNAIL_STYLES),
  caption_first_line: z.string().describe("keyword in the opening line"),
  on_screen_text: z.array(z.string()).describe("short on-screen text lines that include the keyword"),
  spoken_keyword_line: z.string().describe("a line said out loud containing the keyword (video), or empty"),
  alt_text: z.string().describe("image and carousel posts: describe the image with the keyword, or empty"),
  hashtags: z.array(z.string()).describe("a few precise hashtags that classify the post"),
  misspelling_tags: z.array(z.string()).describe("YouTube only: common misspellings of the keyword, if any"),
});
export type OptimizationDraft = z.infer<typeof OptimizationDraft>;

export const Optimization = z.object({
  primary_keyword: z.string(),
  secondary_keywords: z.array(z.string()),
  keyword_check: z.object({
    source: z.literal("youtube_data_api"), checked_at: z.string(), region: z.string().nullable(),
    top_results: z.array(z.object({ title: z.string(), channel: z.string(), views: z.number().nullable(), url: z.string() })),
    suggested_angle: z.string(),
  }).nullable().optional(),
  titles: z.array(z.string()).optional(),
  description: z.string().optional(),
  chapters: z.array(z.object({ t: z.string(), title: z.string() })).optional(),
  thumbnails: z.array(z.object({ concept: z.string(), text: z.string(), subject: z.string(), layout: z.string(), colors: z.array(z.string()) })).optional(),
  thumbnail_spec: z.object({ size: z.string(), ratio: z.string(), max_mb: z.number(), safe_zone: z.string() }).optional(),
  caption_first_line: z.string().optional(),
  on_screen_text: z.array(z.string()).optional(),
  spoken_keyword_line: z.string().optional(),
  alt_text: z.string().optional(),
  hashtags: z.array(z.string()),
  tags: z.array(z.string()).optional(),
  title_style: z.enum(TITLE_STYLES),
  thumbnail_style: z.enum(THUMBNAIL_STYLES).optional(),
});
export type Optimization = z.infer<typeof Optimization>;

export const HASHTAG_CAP: Record<Platform, number> = { instagram: 5, tiktok: 5, linkedin: 3, youtube: 3, facebook: 3 };

/** Rules added to the adapter prompt, per platform. */
export function optimizationRules(platform: Platform): string {
  const common = "Search optimisation: pick the phrase a buyer would actually type; put it in the opening words, on screen and (for video) spoken once. Never keyword-stuff.";
  const per: Record<Platform, string> = {
    youtube: "YouTube: write 3 distinct titles (keyword early, under 70 characters, a promise the video keeps), a description whose first two lines carry the keyword, chapters for videos over 60 seconds (first 00:00, at least 3, each at least 10 seconds), and 3 different thumbnail concepts (4 words of text or fewer, one clear subject, high contrast, nothing important in the bottom-right corner). Tags: only common misspellings of the keyword.",
    instagram: "Instagram: the keyword goes in the first caption line, the on-screen text and the alt text; 3-5 precise hashtags at most.",
    tiktok: "TikTok: the keyword goes in the caption, the on-screen text and one spoken line; up to 5 precise hashtags.",
    linkedin: "LinkedIn: the keyword in the first two lines only; at most 3 hashtags; alt text for images and documents.",
    facebook: "Facebook: keyword early in the caption; at most 3 hashtags.",
  };
  return `${common}\n${per[platform]}`;
}

const secs = (t: string): number | null => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** YouTube's chapter rules: first at 00:00, ascending, >= 10 s apart, at least 3, inside the video. */
export function validChapters(chapters: { t: string; title: string }[], lengthSeconds: number | null): { t: string; title: string }[] {
  const parsed = chapters.map((c) => ({ s: secs(c.t), title: c.title.trim() })).filter((c): c is { s: number; title: string } => c.s != null && !!c.title);
  if (!parsed.length) return [];
  parsed[0]!.s = 0;
  const out: { s: number; title: string }[] = [];
  for (const c of parsed) {
    const prev = out[out.length - 1];
    if (prev && c.s - prev.s < 10) continue;
    if (lengthSeconds != null && c.s >= lengthSeconds - 10 && out.length) continue;
    out.push(c);
  }
  return out.length >= 3 ? out.map((c) => ({ t: fmt(c.s), title: c.title.slice(0, 80) })) : [];
}

const tag = (h: string) => `#${h.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")}`;

export function finalizeOptimization(platform: Platform, d: OptimizationDraft, opts: { brandColors: string[]; lengthSeconds: number | null }): Optimization {
  const hashtags = [...new Set(d.hashtags.map(tag).filter((h) => h.length > 2))].slice(0, HASHTAG_CAP[platform]);
  const base: Optimization = {
    primary_keyword: d.primary_keyword.trim(),
    secondary_keywords: d.secondary_keywords.map((k) => k.trim()).filter(Boolean).slice(0, 4),
    caption_first_line: d.caption_first_line.trim() || undefined,
    on_screen_text: d.on_screen_text.map((t) => t.trim()).filter(Boolean).slice(0, 6),
    hashtags,
    title_style: d.title_style,
  };
  if (d.spoken_keyword_line.trim() && platform !== "linkedin" && platform !== "facebook") base.spoken_keyword_line = d.spoken_keyword_line.trim();
  if (d.alt_text.trim() && platform !== "youtube" && platform !== "tiktok") base.alt_text = d.alt_text.trim().slice(0, 1000);
  if (platform !== "youtube") return base;
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  return {
    ...base,
    titles: [...new Set(d.titles.map((t) => t.trim()).filter(Boolean))].map((t) => t.slice(0, 100)).slice(0, 3),
    description: d.description.trim().slice(0, 5000),
    chapters: validChapters(d.chapters, opts.lengthSeconds),
    thumbnails: d.thumbnails.slice(0, 3).map((t) => ({ concept: t.concept.trim(), text: words(t.text).slice(0, 4).join(" "), subject: t.subject.trim(), layout: t.layout.trim(), colors: opts.brandColors.slice(0, 3) })),
    thumbnail_spec: { size: "1280x720", ratio: "16:9", max_mb: 2, safe_zone: "Keep text and faces out of the bottom-right corner (the duration badge) and away from the edges." },
    thumbnail_style: d.thumbnail_style,
    tags: d.misspelling_tags.map((t) => t.trim()).filter(Boolean).slice(0, 5),
  };
}

/** Features the learning loop tracks from a brief's optimisation. */
export function optimizationFeatures(o: Optimization): Record<string, string> {
  const kw = o.primary_keyword.toLowerCase();
  const title = o.titles?.[0]?.toLowerCase();
  return {
    title_style: o.title_style,
    ...(o.thumbnail_style ? { thumbnail_style: o.thumbnail_style } : {}),
    ...(title != null ? { keyword_in_title: kw && title.includes(kw) ? "yes" : "no" } : {}),
  };
}

// ---------------------------------------------------------------------------
// Free keyword check: what already ranks on YouTube (cached 7 days, within quota)
// ---------------------------------------------------------------------------

interface SearchResp { items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[] }
interface VideosResp { items?: { id: string; statistics?: { viewCount?: string } }[] }

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function suggestedAngle(keyword: string, results: { title: string; views: number | null }[]): string {
  if (!results.length) return "Few videos target this phrase: a clear title with the keyword up front can rank.";
  const kw = keyword.toLowerCase();
  const withKw = results.filter((r) => r.title.toLowerCase().includes(kw)).length;
  const views = results.map((r) => r.views).filter((v): v is number => v != null).sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)]! : null;
  const big = median != null && median > 100_000;
  if (withKw >= 3 && big) return `Crowded with big channels (median ${Math.round(median! / 1000)}k views). Lead with what only you can say: your market, a real number or a client type, not the bare keyword.`;
  if (withKw >= 3) return "Several videos use this exact phrase. Differentiate the title with a specific angle, place or result.";
  return "Top results don't use this exact phrase in the title: keyword-first titles have room here.";
}

export async function youtubeKeywordCheck(db: Db, keyword: string, region: string | null, language: string | null): Promise<Optimization["keyword_check"]> {
  const key = config().YOUTUBE_API_KEY;
  const q = keyword.trim().toLowerCase();
  if (!key || q.length < 3) return null;
  const reg = region && /^[A-Z]{2}$/.test(region) ? region : "";
  const cached = (await db.query<{ results: NonNullable<Optimization["keyword_check"]>["top_results"]; fetched_at: Date }>(
    "select results, fetched_at from youtube_keyword_cache where keyword = $1 and region = $2 and fetched_at > now() - interval '7 days'", [q, reg],
  )).rows[0];
  let top = cached?.results;
  let checkedAt = cached?.fetched_at?.toISOString();
  if (!top) {
    // search.list costs 100 units and videos.list 1, from a 10,000-unit daily quota. Skip rather than fail when it's spent.
    if (bucketFor("youtube_quota").tryTake(101) > 0) return null;
    const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: "5", q, key, ...(reg ? { regionCode: reg } : {}), ...(language ? { relevanceLanguage: language.split("-")[0]! } : {}) });
    try {
      const s = await fetchJson<SearchResp>(`https://www.googleapis.com/youtube/v3/search?${params}`, { limitKey: "youtube_api", maxRetries: 1, timeoutMs: 8_000 });
      const ids = (s.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
      const v = ids.length ? await fetchJson<VideosResp>(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}&key=${key}`, { limitKey: "youtube_api", maxRetries: 1, timeoutMs: 8_000 }) : { items: [] };
      top = (s.items ?? []).filter((i) => i.id?.videoId).map((i) => ({
        title: decode(i.snippet?.title ?? ""), channel: decode(i.snippet?.channelTitle ?? ""),
        views: Number(v.items?.find((x) => x.id === i.id!.videoId)?.statistics?.viewCount ?? NaN) || null,
        url: `https://www.youtube.com/watch?v=${i.id!.videoId}`,
      }));
      checkedAt = new Date().toISOString();
      await db.query(
        `insert into youtube_keyword_cache (keyword, region, results) values ($1,$2,$3)
         on conflict (keyword, region) do update set results = excluded.results, fetched_at = now()`, [q, reg, JSON.stringify(top)],
      );
    } catch (err) {
      console.warn(`[youtube keyword] ${(err as Error).message}`);
      return null;
    }
  }
  return { source: "youtube_data_api", checked_at: checkedAt!, region: reg || null, top_results: top, suggested_angle: suggestedAngle(q, top) };
}

// ---------------------------------------------------------------------------
// Figures rule: numbers in a brief must come from the knowledge or the idea
// ---------------------------------------------------------------------------

/** Numbers that matter (percentages, money, counts of 2+ digits), normalised. */
export function figuresIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:[₦$€£]\s?)?\d[\d,.]*(?:\s?(?:%|k|m|bn|million|billion|x))?/gi)) {
    const raw = m[0].trim().replace(/[.,]$/, "");
    const digits = raw.replace(/[^\d.]/g, "");
    if (!digits || (digits.replace(".", "").length < 2 && !/[%₦$€£x]/i.test(raw))) continue;
    if (/^(19|20)\d{2}$/.test(digits)) continue; // years
    out.add(raw.toLowerCase().replace(/\s+/g, ""));
  }
  return [...out];
}

/** Figures the brief uses that appear nowhere in the allowed sources (idea, evidence, knowledge, Brand Brain). */
export function unverifiedFigures(briefText: string, allowedText: string): string[] {
  const allowed = new Set(figuresIn(allowedText).map((f) => f.replace(/[^\d.]/g, "")));
  return figuresIn(briefText).filter((f) => !allowed.has(f.replace(/[^\d.]/g, "")));
}
