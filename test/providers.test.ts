import { describe, expect, it } from "vitest";
import { normalizeInstagram, parseInsights } from "../src/providers/own/instagram.js";
import { normalizeFacebook } from "../src/providers/own/facebook.js";
import { normalizeTikTok } from "../src/providers/own/tiktok.js";
import { analyticsRow, normalizeYouTube, parseIsoDuration } from "../src/providers/own/youtube.js";
import { normalizeLinkedInOrg } from "../src/providers/own/linkedin.js";
import { mapDiscoveryMedia } from "../src/providers/competitor/instagramBusinessDiscovery.js";
import { mapVideos } from "../src/providers/competitor/youtube.js";
import { parseTrendsRss } from "../src/providers/signals/googleTrendsRss.js";

describe("own analytics normalisation (nulls are never guessed)", () => {
  it("instagram insights", () => {
    const v = parseInsights({ data: [
      { name: "views", values: [{ value: 5000 }] },
      { name: "saved", values: [{ value: 40 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 7300 }] },
      { name: "total_interactions", total_value: { value: 300 } },
    ] });
    const m = normalizeInstagram(v);
    expect(m).toMatchObject({ views: 5000, saves: 40, avg_watch_seconds: 7.3, link_clicks: null, sends: null });
  });

  it("facebook", () => {
    expect(normalizeFacebook({ post_impressions_unique: 900, post_clicks: 12 }, { reactions: 30, comments: 4, shares: 2 }))
      .toMatchObject({ reach: 900, link_clicks: 12, likes: 30, comments: 4, shares: 2, views: null });
  });

  it("tiktok", () => {
    expect(normalizeTikTok({ id: "1", create_time: 0, view_count: 1200, like_count: 80, comment_count: 5, share_count: 3 }))
      .toMatchObject({ views: 1200, likes: 80, comments: 5, shares: 3, saves: null, reach: null });
  });

  it("youtube merges realtime counts with analytics", () => {
    expect(parseIsoDuration("PT1M5S")).toBe(65);
    expect(parseIsoDuration("PT45S")).toBe(45);
    const a = analyticsRow({ columnHeaders: [{ name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }, { name: "subscribersGained" }], rows: [[900, 20, 64, 3]] });
    expect(normalizeYouTube({ viewCount: "1000", likeCount: "50" }, a, 30))
      .toMatchObject({ views: 1000, likes: 50, avg_watch_seconds: 20, completion_rate: 0.64, followers_gained: 3, comments: null });
    expect(normalizeYouTube({ viewCount: "10" }, { averageViewDuration: 15 }, 30).completion_rate).toBe(0.5);
  });

  it("linkedin org stats", () => {
    expect(normalizeLinkedInOrg({ impressionCount: 2000, uniqueImpressionsCount: 1500, clickCount: 30 }))
      .toMatchObject({ views: 2000, reach: 1500, link_clicks: 30, saves: null });
  });
});

describe("competitor mapping", () => {
  it("business discovery keeps source links", () => {
    const r = mapDiscoveryMedia("bakery", [{ id: "1", like_count: 10, comments_count: 2, permalink: "https://instagram.com/p/1", media_product_type: "REELS" }]);
    expect(r[0]).toMatchObject({ platform: "instagram", likes: 10, views: null, source_url: "https://instagram.com/p/1", media_type: "REELS" });
  });
  it("youtube videos: shorts vs long form", () => {
    const r = mapVideos([{ id: "v", snippet: { title: "t", description: "d", publishedAt: "2026-09-01T00:00:00Z" }, statistics: { viewCount: "10" }, contentDetails: { duration: "PT50S" } }]);
    expect(r[0]).toMatchObject({ media_type: "short", views: 10, likes: null });
  });
});

describe("google trends rss", () => {
  it("parses items, traffic and news", () => {
    const xml = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
      <item><title>jollof festival</title><ht:approx_traffic>20,000+</ht:approx_traffic><pubDate>Wed, 24 Sep 2026 08:00:00 +0000</pubDate>
        <ht:news_item><ht:news_item_title>Lagos hosts</ht:news_item_title><ht:news_item_url>https://news.example/a</ht:news_item_url></ht:news_item></item>
      <item><title>rain</title><ht:approx_traffic>500+</ht:approx_traffic></item>
    </channel></rss>`;
    const s = parseTrendsRss(xml, "NG");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ topic: "jollof festival", geo: "NG", url: "https://news.example/a" });
    expect(s[0]!.momentum!).toBeGreaterThan(s[1]!.momentum!);
  });
});
