import type { Db } from "../db.js";
import { Brief } from "../contracts/brief.js";
import { newId } from "../lib/ids.js";
import { seededRng } from "../lib/stats.js";
import { refreshPerformance } from "../analytics/ingest.js";
import { postingTimeFeatures } from "../analytics/features.js";
import { rescoreWorkspace } from "../ideation/precompute.js";
import { withUtm } from "../handoff/utm.js";
import { playbook, aspectRatioFor } from "../playbooks/index.js";
import { weeklyTables, type ReportPost, type RollingPoint } from "../reports/tables.js";
import type { Platform } from "../types.js";

/**
 * Demo workspace: a fictional Lagos bakery with ~12 weeks of history, so every
 * screen can be explored before real accounts are connected or a Claude key is
 * set. Nothing here calls Claude or a platform API. All numbers are generated
 * with a seeded RNG and then run through the real analytics views, so PI,
 * baselines, rolling stats and learned patterns are computed exactly as they
 * would be for real data.
 */

const DAY = 86_400_000;
const WEBSITE = "https://crumbandco.example";

const HOOK_EFFECT: Record<string, number> = {
  price_reveal: 2.1, before_after: 1.6, question: 1.1, story: 0.95, list: 1.0, mistake: 0.75, behind_the_scenes: 0.8,
};
const HOOKS = Object.keys(HOOK_EFFECT);

const CAPTIONS: Record<string, string[]> = {
  price_reveal: ["This ₦45k cake cost ₦52k to make. Here's the breakdown.", "What a ₦120k wedding cake actually pays for", "I priced this cake wrong for 2 years"],
  before_after: ["From sketch to showpiece in 14 hours", "Buttercream at 9am vs 3pm in Lagos heat", "Client's Pinterest photo vs what we made"],
  question: ["You asked: how far ahead should I order a wedding cake?", "Is fondant really that bad?", "Which filling would you pick?"],
  story: ["The cake that almost didn't make it to the wedding", "Why I left banking to bake", "Our first ever order, 6 years ago"],
  list: ["5 flavours Lagos couples loved this year", "3 things to ask before booking a baker", "4 cakes you can order this week"],
  mistake: ["Pricing mistakes that keep home bakers broke", "Don't make this delivery mistake", "The fridge mistake that ruins buttercream"],
  behind_the_scenes: ["A Friday in the kitchen", "How we prep 200 cupcakes", "Packing orders at 5am"],
};

interface DemoPost {
  id: string;
  platform: Platform;
  published_at: Date;
  views72: number;
  hook: string;
  format: string;
  caption: string;
  brief_id: string | null;
  idea_id: string | null;
  link_status: string;
}

const PLAN: { platform: Platform; count: number; base: number; formats: string[]; duration: [number, number] }[] = [
  { platform: "instagram", count: 26, base: 1400, formats: ["reel", "reel", "carousel"], duration: [18, 45] },
  { platform: "tiktok", count: 18, base: 2600, formats: ["vertical_video"], duration: [15, 40] },
  { platform: "youtube", count: 9, base: 900, formats: ["short"], duration: [25, 58] },
];

/** Share of 72 h views seen at each snapshot, so the post-detail curve looks real. */
const CURVE: [string, number][] = [["1h", 0.07], ["6h", 0.31], ["24h", 0.66], ["72h", 1], ["7d", 1.14], ["28d", 1.22]];

export async function seedDemoWorkspace(db: Db, now = new Date()): Promise<string> {
  const rng = seededRng(20260926);
  const ws = newId("wsp");
  await db.query("insert into workspaces (id, studio_workspace_id, name) values ($1, $2, $3)", [ws, `demo_${ws}`, "Crumb & Co. (demo)"]);
  await db.query(
    `insert into brand_brains (workspace_id, website_url, brand_kit, goal, language, timezone, trends_geo, tone_words, pillars,
       audience, offers, banned_topics, description, industry, country, social_links, competitor_suggestions, confirmed_at)
     values ($1,$2,$3,'leads','en-NG','Africa/Lagos','NG',$4,$5,$6,$7,$8,$9,$10,'NG',$11,$12, now())`,
    [ws, WEBSITE, JSON.stringify({ colors: ["#F4A7B9", "#3B2A20", "#FFF6EC"], fonts: ["Fraunces"] }),
      ["warm", "expert", "honest", "playful"],
      ["Pricing & the business of baking", "Custom cake craft", "Behind the scenes", "Client stories"],
      "Couples and party planners in Lagos ordering custom cakes, plus home bakers who follow for pricing advice",
      JSON.stringify([
        { name: "Custom celebration cakes", description: "Wedding, birthday and corporate cakes made to order", revenue_role: "core", url: `${WEBSITE}/order`, price: "from ₦45,000" },
        { name: "Cake pricing sheet for home bakers", description: "Spreadsheet template and guide", revenue_role: "secondary", url: `${WEBSITE}/pricing-sheet`, price: "₦7,500" },
        { name: "Free tasting box (weddings)", description: "Four flavours for couples who book a consultation", revenue_role: "lead_magnet" },
      ]),
      ["politics", "religion", "competitor call-outs"],
      "A Lagos bakery making custom celebration cakes, and teaching home bakers how to price their work.",
      "Food & bakery",
      JSON.stringify([{ platform: "instagram", url: "https://www.instagram.com/crumbandco.example" }, { platform: "tiktok", url: "https://www.tiktok.com/@crumbandco.example" }]),
      JSON.stringify([
        { name: "Sugar Street Lagos", website: "https://sugarstreet.example", why: "Custom wedding cakes for the same Lagos couples", overlap: ["Custom celebration cakes"], market: "Lagos", confidence: "high", handles: { instagram: "sugarstreet.lagos", youtube: "@sugarstreetlagos" } },
        { name: "Bake With Tolu", website: "https://bakewithtolu.example", why: "Teaches home bakers pricing, same as your pricing sheet", overlap: ["Cake pricing sheet for home bakers"], market: "Nigeria", confidence: "high", handles: { youtube: "@bakewithtolu", tiktok: "bakewithtolu" } },
        { name: "The Frosting Room", website: "https://frostingroom.example", why: "Celebration cakes in Lekki and Ikoyi", overlap: ["Custom celebration cakes"], market: "Lagos", confidence: "medium", handles: { instagram: "thefrostingroom" } },
        { name: "Cake Republic Abuja", website: "https://cakerepublic.example", why: "Similar custom cakes, different city; a useful benchmark", overlap: ["Custom celebration cakes"], market: "Abuja", confidence: "medium", handles: { instagram: "cakerepublic.abj" } },
        { name: "Layers by Nneka", website: null, why: "Home baker brand with a large pricing-tips following", overlap: ["Cake pricing sheet for home bakers"], market: "Nigeria", confidence: "low", handles: { tiktok: "layersbynneka" } },
      ])],
  );

  const accounts: Record<string, string> = {};
  for (const [platform, kind] of [["instagram", "business"], ["tiktok", "creator"], ["youtube", "channel"]] as const) {
    const id = newId("acc");
    accounts[platform] = id;
    await db.query(
      `insert into connected_accounts (id, workspace_id, platform, external_account_id, handle, account_kind, studio_connection_id)
       values ($1,$2,$3,$4,$5,$6,'demo')`,
      [id, ws, platform, `demo_${platform}`, "@crumbandco", kind],
    );
  }

  // Past ideas and briefs, so some posts link back to where they came from.
  const pastIdeas: { id: string; brief: string; platform: Platform; hook: string }[] = [];
  for (const [i, hook] of ["price_reveal", "before_after", "question", "mistake", "price_reveal", "story"].entries()) {
    const platform = (["instagram", "tiktok", "instagram", "tiktok", "youtube", "instagram"] as Platform[])[i]!;
    const ideaId = newId("ide");
    const briefId = newId("brf");
    const title = CAPTIONS[hook]![i % 3]!;
    await db.query(
      `insert into ideas (id, workspace_id, mode, platform, title, why_now, core_idea, features, score, relative_label, confidence,
         content_type, effort, slot, status, created_at)
       values ($1,$2,'give_me_ideas',$3,$4,'Earlier suggestion',$4,$5,60,'top_third','medium',$6,'low','explore','briefed', $7)`,
      [ideaId, ws, platform, title, JSON.stringify({ hook_type: hook, format: PLAN.find((p) => p.platform === platform)!.formats[0], pillar: "Pricing & the business of baking" }),
        PLAN.find((p) => p.platform === platform)!.formats[0], new Date(now.getTime() - (60 - i * 8) * DAY)],
    );
    const brief = demoBrief(ws, ideaId, briefId, platform, title, hook, now);
    await db.query(
      `insert into briefs (id, idea_id, workspace_id, kind, platform, payload, status, created_at, delivered_at)
       values ($1,$2,$3,'platform',$4,$5,'acknowledged',$6,$6)`,
      [briefId, ideaId, ws, platform, JSON.stringify(brief), new Date(now.getTime() - (58 - i * 8) * DAY)],
    );
    pastIdeas.push({ id: ideaId, brief: briefId, platform, hook });
  }

  // History: steadily improving, with hook types that genuinely matter.
  const posts: DemoPost[] = [];
  for (const plan of PLAN) {
    const span = 84 * DAY;
    for (let i = 0; i < plan.count; i++) {
      const t = new Date(now.getTime() - span + (i / plan.count) * span + Math.floor(rng() * 8) * 3_600_000 + 4 * DAY * 0);
      // Recent posts lean on the hooks that work, like a brand following its reports.
      const hook = i > plan.count * 0.6 && rng() < 0.55 ? (rng() < 0.6 ? "price_reveal" : "before_after") : HOOKS[Math.floor(rng() * HOOKS.length)]!;
      const trend = 1 + 0.5 * (i / plan.count);
      const noise = Math.exp((rng() - 0.5) * 0.7);
      const format = plan.formats[Math.floor(rng() * plan.formats.length)]!;
      const linked = pastIdeas.find((p) => p.platform === plan.platform && p.hook === hook && !posts.some((x) => x.brief_id === p.brief));
      posts.push({
        id: newId("pst"),
        platform: plan.platform,
        published_at: t,
        views72: Math.round(plan.base * trend * HOOK_EFFECT[hook]! * noise),
        hook,
        format,
        caption: CAPTIONS[hook]![Math.floor(rng() * 3)]!,
        brief_id: linked && i > plan.count / 3 ? linked.brief : null,
        idea_id: linked && i > plan.count / 3 ? linked.id : null,
        link_status: linked && i > plan.count / 3 ? "linked" : "unmatched",
      });
    }
  }
  // Posts younger than 72 h only have their early snapshots.
  const snapshots: Record<string, unknown>[] = [];
  for (const p of posts) {
    const ageH = (now.getTime() - p.published_at.getTime()) / 3_600_000;
    const dur = Math.round(15 + rng() * 40);
    const features = {
      hook_type: p.hook, format: p.format, pillar: p.hook === "price_reveal" || p.hook === "mistake" ? "Pricing & the business of baking" : "Custom cake craft",
      length_bucket: dur <= 30 ? "16-30s" : "31-60s", language: "en-NG",
      ...postingTimeFeatures(p.published_at, "Africa/Lagos"),
    };
    await db.query(
      `insert into published_posts (id, workspace_id, connected_account_id, platform, platform_post_id, brief_id, idea_id,
         published_at, permalink, caption, duration_seconds, features, link_status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [p.id, ws, accounts[p.platform], p.platform, `demo_${p.id}`, p.brief_id, p.idea_id, p.published_at,
        `https://example.com/${p.platform}/${p.id}`, p.caption, dur, JSON.stringify(features), p.link_status],
    );
    for (const [label, share] of CURVE) {
      const offH = label === "1h" ? 1 : label === "6h" ? 6 : label === "24h" ? 24 : label === "72h" ? 72 : label === "7d" ? 168 : 672;
      if (ageH < offH) continue;
      const v = Math.round(p.views72 * share);
      const eng = rng() * 0.02 + 0.03;
      snapshots.push({
        published_post_id: p.id, offset_label: label, views: v, reach: Math.round(v * 0.78),
        likes: Math.round(v * eng), comments: Math.round(v * eng * 0.08), shares: Math.round(v * eng * 0.12),
        saves: p.platform === "instagram" ? Math.round(v * eng * 0.25) : null, sends: p.platform === "instagram" ? Math.round(v * eng * 0.18) : null,
        avg_watch_seconds: Math.round(dur * (0.35 + rng() * 0.3) * 10) / 10,
        completion_rate: Math.round((0.25 + rng() * 0.35) * 100) / 100,
        link_clicks: Math.round(v * (p.hook === "price_reveal" ? 0.012 : 0.005)),
        profile_visits: Math.round(v * 0.01), followers_gained: Math.round(v * 0.003),
        captured_at: new Date(p.published_at.getTime() + offH * 3_600_000).toISOString(),
      });
    }
    // A handful of snapshots still to come, so the schedule is visible too.
    for (const [label] of CURVE) {
      const offH = label === "1h" ? 1 : label === "6h" ? 6 : label === "24h" ? 24 : label === "72h" ? 72 : label === "7d" ? 168 : 672;
      if (ageH < offH) {
        await db.query("insert into snapshot_jobs (published_post_id, offset_label, due_at) values ($1,$2,$3) on conflict do nothing",
          [p.id, label, new Date(p.published_at.getTime() + offH * 3_600_000)]);
      }
    }
  }
  await db.query(
    `insert into metric_snapshots (published_post_id, offset_label, views, reach, likes, comments, shares, saves, sends,
       avg_watch_seconds, completion_rate, link_clicks, profile_visits, followers_gained, captured_at)
     select published_post_id, offset_label, views, reach, likes, comments, shares, saves, sends, avg_watch_seconds,
       completion_rate, link_clicks, profile_visits, followers_gained, captured_at
     from jsonb_to_recordset($1::jsonb) as x(published_post_id text, offset_label text, views bigint, reach bigint, likes bigint,
       comments bigint, shares bigint, saves bigint, sends bigint, avg_watch_seconds numeric, completion_rate numeric,
       link_clicks bigint, profile_visits bigint, followers_gained bigint, captured_at timestamptz)`,
    [JSON.stringify(snapshots)],
  );

  // One post published outside the studio that looks like a recent brief: the match inbox.
  const matchPost = newId("pst");
  const matchIdea = pastIdeas.at(-1)!;
  await db.query(
    `insert into published_posts (id, workspace_id, connected_account_id, platform, platform_post_id, brief_id, idea_id, published_at,
       caption, features, link_status, match_confidence)
     values ($1,$2,$3,'instagram',$4,$5,$6,$7,$8,'{}','suggested',0.46)`,
    [matchPost, ws, accounts.instagram, `demo_${matchPost}`, matchIdea.brief, matchIdea.id, new Date(now.getTime() - 2 * DAY),
      "Why I left banking to bake, and what the first year cost me"],
  );

  // Competitors and their winners.
  const competitorPosts: string[] = [];
  for (const [name, handles, titles] of [
    ["Sugar Street Lagos", { instagram: "sugarstreet.lagos", youtube: "@sugarstreetlagos" }, ["We charged ₦250k for this cake. Worth it?", "Wedding cake tasting day", "Fondant vs buttercream (honest)"]],
    ["Bake With Tolu", { youtube: "@bakewithtolu", tiktok: "bakewithtolu" }, ["How I price cakes (full spreadsheet)", "Stop undercharging for delivery", "My oven broke mid-order"]],
    ["The Frosting Room", { instagram: "thefrostingroom" }, ["3-hour heat test: which icing survives Lagos?", "Client sent this photo...", "Tiered cake assembly timelapse"]],
  ] as const) {
    const cmp = newId("cmp");
    await db.query("insert into competitors (id, workspace_id, name, handles) values ($1,$2,$3,$4)", [cmp, ws, name, JSON.stringify(handles)]);
    for (const [k, title] of titles.entries()) {
      const id = newId("cpp");
      const platform = (Object.keys(handles)[k % Object.keys(handles).length] ?? "instagram") as Platform;
      const ratio = k === 0 ? 3.4 + rng() : k === 1 ? 2.6 + rng() * 0.5 : 0.8 + rng();
      await db.query(
        `insert into competitor_posts (id, workspace_id, competitor_id, platform, platform_post_id, permalink, title, caption, media_type,
           published_at, views, likes, comments, outlier_ratio, source_url, vision_tags)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$6,$14)`,
        [id, ws, cmp, platform, `demo_${id}`, `https://example.com/${platform}/${id}`, title, platform === "youtube" ? "short" : "REELS",
          new Date(now.getTime() - (5 + k * 6) * DAY), Math.round(9000 * ratio), Math.round(400 * ratio), Math.round(35 * ratio), ratio,
          JSON.stringify({ hook_type: k === 0 ? "price_reveal" : k === 1 ? "mistake" : "before_after", visual_style: "talking_head", format_guess: "reel", topic: "cake pricing", angle: title, on_screen_text: null })],
      );
      if (ratio >= 2.5) competitorPosts.push(id);
    }
  }

  // Trend signals and the audience's own questions.
  const signalIds: string[] = [];
  for (const [source, title, momentum, url] of [
    ["google_trends_rss", "Detty December wedding season", 0.86, "https://trends.google.com/trending?geo=NG"],
    ["wikipedia_pageviews", "Wedding cake", 0.71, "https://en.wikipedia.org/wiki/Wedding_cake"],
    ["youtube_most_popular", "Nigerian wedding highlights 2026", 0.78, "https://www.youtube.com/feed/trending"],
    ["google_trends_rss", "Cost of flour Nigeria", 0.64, "https://trends.google.com/trending?geo=NG"],
  ] as const) {
    const id = newId("sig");
    signalIds.push(id);
    await db.query(
      `insert into signals (id, workspace_id, source, topic, title, url, geo, momentum, observed_at)
       values ($1,$2,$3,$4,$4,$5,'NG',$6, now() - interval '1 day')`,
      [id, ws, source, title, url, momentum],
    );
  }
  const questionIds: string[] = [];
  for (const [text, likes] of [
    ["How much for a 3 tier wedding cake for 200 guests?", 42],
    ["How do you stop buttercream melting at outdoor parties in Lagos?", 31],
    ["Do you deliver to Lekki and how much is delivery?", 18],
    ["How far ahead should I book for December?", 25],
    ["Can you do a cake that looks like this for ₦30k?", 12],
  ] as const) {
    const id = newId("cmt");
    questionIds.push(id);
    const p = posts.filter((x) => x.platform === "instagram").at(-1 - questionIds.length)!;
    await db.query(
      `insert into audience_comments (id, workspace_id, origin, platform, platform_post_id, platform_comment_id, text, like_count, is_question, published_at)
       values ($1,$2,'own','instagram',$3,$4,$5,$6,true, now() - interval '3 days')`,
      [id, ws, `demo_${p.id}`, `demo_${id}`, text, likes],
    );
  }

  await refreshPerformance(db);

  // This week's Idea Cards; the learning loop then scores and labels them.
  const best = await db.query<{ post_id: string; pi: number; caption: string }>(
    `select m.post_id, m.pi::float8 as pi, p.caption from mv_post_performance m join published_posts p on p.id = m.post_id
     where m.workspace_id = $1 and m.pi is not null order by m.pi desc limit 3`, [ws],
  );
  const own = best.rows;
  const ev = {
    own: (i: number) => own[i] ? [{ kind: "own_post", id: own[i]!.post_id, url: null, summary: `Your post did ${own[i]!.pi.toFixed(1)}× your baseline: ${own[i]!.caption}` }] : [],
    question: (i: number) => [{ kind: "comment", id: questionIds[i]!, url: null, summary: `Your audience asked: "${["How much for a 3 tier wedding cake for 200 guests?", "How do you stop buttercream melting at outdoor parties in Lagos?", "Do you deliver to Lekki and how much is delivery?", "How far ahead should I book for December?", "Can you do a cake that looks like this for ₦30k?"][i]}"` }],
    competitor: (i: number) => competitorPosts[i] ? [{ kind: "competitor_post", id: competitorPosts[i]!, url: `https://example.com/competitor/${competitorPosts[i]}`, summary: "Competitor post at 3.1× their usual views" }] : [],
    trend: (i: number) => [{ kind: "trend", id: signalIds[i]!, url: null, summary: ["Google Trends: Detty December wedding season (rising)", "Wikipedia: Wedding cake page views up this month", "YouTube trending: Nigerian wedding highlights", "Google Trends: Cost of flour Nigeria"][i]! }],
  };
  const cards: [Platform, string, string, string, string, string, string, unknown[], string, [number, number, number, number]][] = [
    ["instagram", "The ₦45k cake that cost us ₦52k to make", "Price reveals are your strongest opener, and three people asked about prices this week.", "Walk through the real cost of one custom cake line by line, ending on what you should have charged.", "price_reveal", "reel", "low", [...ev.own(0), ...ev.question(0)], "Pricing & the business of baking", [0.9, 0.35, 0.55, 0.6]],
    ["tiktok", "Buttercream vs. whipped cream: a 3-hour Lagos heat test", "Your audience keeps asking about melting; a competitor's heat test hit 3× their usual views.", "Two identical cakes outside from noon to 3pm, checking every hour. Payoff: the one that survives.", "before_after", "vertical_video", "medium", [...ev.question(1), ...ev.competitor(0)], "Custom cake craft", [0.85, 0.8, 0.5, 0.7]],
    ["instagram", "\"How much for a 3-tier cake for 200 guests?\" — answered", "Your most-liked question this month, and wedding searches are rising for December.", "Carousel: the 4 things that set a wedding cake's price, with a real example quote on the last slide.", "question", "carousel", "low", [...ev.question(0), ...ev.trend(0)], "Pricing & the business of baking", [0.8, 0.4, 0.86, 0.5]],
    ["youtube", "From sketch to showpiece: a 14-hour custom cake in 45 seconds", "Before-and-after posts beat your baseline on every platform.", "Timelapse of one custom order, opening on the finished cake next to the client's sketch.", "before_after", "short", "high", [...ev.own(1), ...ev.competitor(1)], "Custom cake craft", [0.8, 0.7, 0.4, 0.6]],
    ["tiktok", "5 pricing mistakes that keep home bakers broke", "Home bakers follow you for pricing advice; this also sells the pricing sheet.", "Rapid list with one example per mistake; CTA to the pricing sheet.", "mistake", "vertical_video", "low", [...ev.competitor(1)], "Pricing & the business of baking", [0.75, 0.6, 0.3, 0.55]],
    ["youtube", "Book by November or miss December: the wedding cake calendar", "Wedding season searches are climbing now, and people are asking how early to book.", "Countdown from the wedding date back to the order date, with the three deadlines couples miss.", "list", "short", "low", [...ev.question(3), ...ev.trend(0)], "Client stories", [0.7, 0.3, 0.86, 0.7]],
    ["instagram", "Why we stopped offering free tastings", "A story post to test: you have little data on story openers, and this one sets up pricing.", "A short honest story about the cost of free tastings and what replaced them.", "story", "reel", "low", [...ev.own(2)], "Behind the scenes", [0.7, 0.2, 0.3, 0.75]],
    ["tiktok", "What ₦30k actually gets you in a custom cake", "Answers a comment directly and reuses your best-performing hook.", "Show three ₦30k options side by side with what changes the price.", "price_reveal", "vertical_video", "low", [...ev.question(4), ...ev.own(0)], "Pricing & the business of baking", [0.85, 0.3, 0.4, 0.5]],
  ];
  const runId = newId("run");
  for (const [platform, title, why, core, hook, format, effort, evidence, pillar, [F, P, M, W]] of cards) {
    const G = format === "carousel" ? 0.9 : format === "short" ? 0.6 : 0.7;
    await db.query(
      `insert into ideas (id, workspace_id, run_id, mode, platform, title, why_now, core_idea, evidence, features, score_components,
         content_type, effort, risks, slot, status, expires_at)
       values ($1,$2,$3,'give_me_ideas',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'explore','candidate', now() + interval '14 days')`,
      [newId("ide"), ws, runId, platform, title, why, core, JSON.stringify(evidence),
        JSON.stringify({ hook_type: hook, format, pillar, idea_source: evidence.length && (evidence[0] as { kind: string }).kind === "comment" ? "audience_question" : "own_winner", cta_type: "link_in_bio", visual_style: "talking_head", length_bucket: "16-30s", language: "en-NG" }),
        JSON.stringify({ L: null, F, P, M, W, G }), format, effort,
        hook === "price_reveal" ? ["Share real numbers only if you're comfortable; clients may ask for the same price"] : []],
    );
  }
  await rescoreWorkspace(db, ws, rng);

  // Pre-rendered Autopilot drafts for the top idea per platform (so Autopilot works without a Claude key).
  for (const platform of ["instagram", "tiktok", "youtube"] as Platform[]) {
    const top = await db.query<{ id: string; title: string; features: { hook_type: string } }>(
      `select id, title, features from ideas where workspace_id = $1 and platform = $2 and status = 'shortlisted'
       order by (slot = 'exploit') desc, score desc limit 1`, [ws, platform],
    );
    const idea = top.rows[0];
    if (!idea) continue;
    const briefId = newId("brf");
    await db.query(
      `insert into briefs (id, idea_id, workspace_id, kind, platform, payload, status) values ($1,$2,$3,'platform',$4,$5,'draft')`,
      [briefId, idea.id, ws, platform, JSON.stringify(demoBrief(ws, idea.id, briefId, platform, idea.title, idea.features.hook_type, now))],
    );
  }

  await seedReport(db, ws, now, posts);
  await db.query(
    `insert into cost_log (workspace_id, task, model, input_tokens, output_tokens, cache_read_tokens, batch, cost_usd, created_at)
     values ($1,'ideator','claude-sonnet-5',6200,3100,9800,false,0.0453, now() - interval '1 day'),
            ($1,'critic','claude-haiku-4-5',2100,900,9800,false,0.0076, now() - interval '1 day'),
            ($1,'adapter:instagram','claude-haiku-4-5',1800,1400,7200,false,0.0095, now() - interval '1 day'),
            ($1,'vision:tag','claude-haiku-4-5',14000,2400,0,true,0.0130, now() - interval '1 day'),
            ($1,'report:weekly','claude-sonnet-5',5200,1600,3000,false,0.0270, now() - interval '2 days')`,
    [ws],
  );
  return ws;
}

async function seedReport(db: Db, ws: string, now: Date, posts: DemoPost[]): Promise<void> {
  const lookback = (await db.query(
    `select m.post_id, m.platform, m.published_at::text, m.views::float8 as views, m.pi::float8 as pi, m.goal_index::float8 as goal_index,
            s.comments::float8 as comments, null as label, m.features
     from mv_post_performance m left join metric_snapshots s on s.published_post_id = m.post_id and s.offset_label = '72h'
     where m.workspace_id = $1 and m.published_at >= $2 and m.views_basis = '72h' order by m.published_at`,
    [ws, new Date(now.getTime() - 28 * DAY)],
  )).rows as ReportPost[];
  const rolling = (await db.query(
    `select platform, week::text, median_views::float8 as median_views, p25_views::float8 as p25_views, hit_rate::float8 as hit_rate
     from v_rolling_weekly where workspace_id = $1 order by week`, [ws],
  )).rows as RollingPoint[];
  const tables = weeklyTables({ start: new Date(now.getTime() - 7 * DAY), end: now }, lookback, rolling, {});
  const reveal = tables.features.find((f) => f.value === "price_reveal" && f.platform === "instagram") ?? tables.features.find((f) => f.value === "price_reveal");
  // Only call something weak if it genuinely came in under the usual.
  const weak = [...tables.features].filter((f) => f.feature === "hook_type" && f.mean_pi < 1).sort((a, b) => a.mean_pi - b.mean_pi)[0];
  const platformName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  const ig = tables.platforms.find((p) => p.platform === "instagram");
  const pick = (ids: string[] | undefined) => (ids ?? []).slice(0, 3);
  const body = {
    headline: "Price reveals keep winning, and your typical post is climbing",
    what_worked: reveal ? [{ text: `Your ${reveal.n} ${platformName(reveal.platform)} posts that opened with a price reveal averaged ${reveal.mean_pi}× your baseline.`, post_ids: pick(reveal.post_ids) }] : [],
    what_didnt: weak ? [{ text: `Posts that opened with a ${weak.value.replace(/_/g, " ")} on ${platformName(weak.platform)} came in under your usual: ${weak.mean_pi}× across ${weak.n} posts.`, post_ids: pick(weak.post_ids) }] : [],
    why: reveal ? [{ text: "A specific number in the first second gives viewers a reason to stay for the breakdown. This is a pattern across a few posts, not proof.", post_ids: pick(reveal.post_ids).slice(0, 2) }] : [],
    what_next: reveal ? [{ platform: "instagram", feature: "hook_type", value: "price_reveal", action: "prefer", share: 0.67, rationale: "2 of 3 reels next week will open with a price reveal.", post_ids: pick(reveal.post_ids) }] : [],
    nudges: [
      `Your posts got ${ig?.comments_this_period ?? 0} comments on Instagram this week. Replying in the first hour tends to lift engagement.`,
      "Wedding-season searches are rising; book-ahead content has a window right now.",
    ],
  };
  const id = newId("rpt");
  await db.query(
    `insert into reports (id, workspace_id, kind, period_start, period_end, input_table, body) values ($1,$2,'weekly',$3,$4,$5,$6)`,
    [id, ws, new Date(now.getTime() - 7 * DAY), now, JSON.stringify(tables), JSON.stringify(body)],
  );
  if (reveal) {
    await db.query(
      `insert into guidance_rules (id, workspace_id, platform, feature, value, action, share, rationale, source_report_id, active_until)
       values ($1,$2,'instagram','hook_type','price_reveal','prefer',0.67,'2 of 3 reels next week will open with a price reveal.',$3, now() + interval '14 days')`,
      [newId("rul"), ws, id],
    );
  }
  // Autopsies for the two most recent posts that have a 72 h result.
  const recent = await db.query<{ post_id: string; pi: number; views: number; baseline_views: number }>(
    `select post_id, pi::float8 as pi, views::float8 as views, baseline_views::float8 as baseline_views from mv_post_performance
     where workspace_id = $1 and pi is not null order by published_at desc limit 2`, [ws],
  );
  for (const r of recent.rows) {
    const verdict = r.pi >= 1.15 ? "beat_baseline" : r.pi >= 0.85 ? "near_baseline" : "below_baseline";
    const post = posts.find((p) => p.id === r.post_id);
    await db.query(
      `insert into reports (id, workspace_id, kind, published_post_id, input_table, body) values ($1,$2,'autopsy',$3,$4,$5)`,
      [newId("rpt"), ws, r.post_id, JSON.stringify(r), JSON.stringify({
        verdict,
        summary: `This post reached ${Math.round(r.views).toLocaleString("en-US")} views in 72 hours against your usual ${Math.round(r.baseline_views).toLocaleString("en-US")}, so ${r.pi.toFixed(1)}× your baseline. It opened with a ${post?.hook.replace(/_/g, " ") ?? "hook"}.`,
        takeaway: verdict === "below_baseline" ? "Try the same topic with a price reveal opener next time." : "Keep this opener in the rotation.",
        cited_post_ids: [r.post_id],
      })],
    );
  }
}

/** Hook-appropriate demo copy so drafts read like real briefs. */
function demoCopy(hook: string) {
  if (hook === "price_reveal") {
    return {
      hooks: ["This ₦45k cake cost me ₦52k to make", "Stop pricing cakes like this", "The hidden cost in every custom cake"],
      structure: [
        { t: "0-2s", beat: "Hook", on_screen_text: "₦45k cake. ₦52k cost.", voiceover: "Say the hook out loud; the audio is indexed." },
        { t: "2-12s", beat: "Where the money went", on_screen_text: "Ingredients ₦18k · 6 hours of flowers · delivery ₦9k", voiceover: "Walk through each cost with the receipts." },
        { t: "12-25s", beat: "The payoff", on_screen_text: "What I charge now", voiceover: "The number, and why." },
        { t: "25-30s", beat: "CTA", on_screen_text: "Pricing sheet in bio", voiceover: "Send this to a baker who undercharges." },
      ],
      script_or_copy: "HOOK: This ₦45,000 cake cost me ₦52,000 to make.\nSETUP: Flour and butter were ₦18k. The sugar flowers took 6 hours. The box, the board and delivery to Lekki were another ₦9k.\nPAYOFF: I was paying people to eat my cake. Now I price for time, not just ingredients.\nCTA: Send this to a baker who undercharges. The pricing sheet is in my bio.",
    };
  }
  return {
    hooks: ["The client sent a sketch. Here's what we made.", "14 hours in 45 seconds", "Watch this cake come together"],
    structure: [
      { t: "0-2s", beat: "Hook", on_screen_text: "Sketch → cake", voiceover: "Open on the finished cake next to the client's sketch." },
      { t: "2-30s", beat: "Timelapse", on_screen_text: "Hour 1… hour 7… hour 14", voiceover: "Quick cuts of each stage: baking, stacking, piping, flowers." },
      { t: "30-40s", beat: "The reveal", on_screen_text: "Delivered to Ikoyi", voiceover: "Slow turn of the finished cake." },
      { t: "40-45s", beat: "CTA", on_screen_text: "Order yours: link in bio", voiceover: "December dates are filling up." },
    ],
    script_or_copy: "HOOK: The client sent a sketch on a napkin. Here's what we made.\nBODY: 14 hours of baking, stacking and sugar flowers, in 45 seconds.\nREVEAL: Delivered to Ikoyi the next morning.\nCTA: December dates are filling up. Order through the link in bio.",
  };
}

function demoBrief(ws: string, ideaId: string, briefId: string, platform: Platform, title: string, hook: string, now: Date): Brief {
  const pb = playbook(platform);
  const format = pb.default_format;
  return Brief.parse({
    schema: "brief.v1",
    brief_id: briefId,
    idea_id: ideaId,
    workspace_id: ws,
    kind: "platform",
    platform,
    format,
    language: "en-NG",
    goal: "leads",
    core_idea: title,
    ...demoCopy(hook),
    visual_direction: { style: "Bright kitchen, handheld, warm light; real receipts on the counter", brand_colors: ["#F4A7B9", "#3B2A20"], shots: ["Close-up of the finished cake", "Receipts spread on the counter", "Hands writing the price on a card"] },
    caption: "Send this to a baker who undercharges 🎂 Full breakdown of what a custom cake really costs in Lagos. Pricing sheet in bio.",
    cta: { type: "link_in_bio", text: "Get the pricing sheet", url: withUtm(`${WEBSITE}/pricing-sheet`, { platform, briefId, ideaId }) },
    length_seconds: pb.length_seconds ? [20, Math.min(35, pb.length_seconds[1])] : null,
    aspect_ratio: aspectRatioFor(pb, format),
    ...(platform === "youtube" ? { title: title.slice(0, 90), thumbnail_brief: "Finished cake on the left, receipt with ₦52,000 circled on the right, big text: 'I LOST MONEY'" } : {}),
    do_not: [...pb.do_not.slice(0, 2), "Open with the logo"],
    evidence_ids: [],
    score: { relative: "top_third", confidence: "medium" },
    label: "proven",
    created_at: now.toISOString(),
  });
}
