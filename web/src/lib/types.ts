export type Platform = "tiktok" | "instagram" | "facebook" | "youtube" | "linkedin";
export type Goal = "reach" | "engagement" | "leads" | "sales";
export type Relative = "top_third" | "middle_third" | "bottom_third";
export type Confidence = "low" | "medium" | "high";

export interface AppConfig { ai_configured: boolean; auth_mode: "token" | "open"; youtube_configured: boolean; max_competitors: number; storage_configured?: boolean }

export interface WorkspaceListItem { id: string; name: string; created_at: string; brain_confirmed: boolean }

export interface Summary {
  id: string; name: string; brain_exists: boolean; confirmed_at: string | null; goal: Goal | null; language: string | null;
  has_draft: boolean; competitors: number; platforms: Platform[]; shortlisted: number; ideas_refreshed_at: string | null;
  briefs: number; briefs_queued: number; posts: number; pending_matches: number; reports: number; jobs_pending: number;
}

export type RevenueRole = "core" | "secondary" | "lead_magnet";
export interface Offer { name: string; url?: string; price?: string; description?: string; category?: string; revenue_role?: RevenueRole }
export type SocialPlatform = "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube" | "x" | "threads" | "whatsapp" | "other";
export interface SocialLink { platform: SocialPlatform; url: string }

export interface BrandBrain {
  website_url: string | null;
  description?: string;
  industry?: string;
  country?: string | null;
  social_links: SocialLink[];
  brand_kit: { colors: string[]; fonts: string[]; logo_url?: string };
  goal: Goal;
  language: string;
  tone_words: string[];
  pillars: string[];
  audience: string;
  buyer_questions?: string[];
  objections?: string[];
  offers: Offer[];
  banned_topics: string[];
  timezone?: string;
  trends_geo?: string | null;
}

export interface BrandBrainRow extends BrandBrain {
  workspace_id: string; name: string; confirmed_at: string | null; draft: (BrandBrain & { name?: string; logos?: string[] }) | null;
}

export interface CompetitorSuggestion {
  name: string; website: string | null; why: string; overlap: string[]; market: string;
  confidence: "high" | "medium" | "low"; handles: Partial<Record<Platform, string>>; tracked?: boolean;
}

export interface BrandDraft {
  brain: BrandBrain; name: string; logos: string[]; competitor_suggestions: CompetitorSuggestion[];
  researched_with_web: boolean; site_reachable: boolean;
  /** Plain-language notes on anything the analysis couldn't do. */
  warnings?: string[];
}

export interface AnalyseInput { website_url: string; goal: Goal; language?: string | null }
export interface AnalyseStage { ok: boolean; warning?: string }

export interface Evidence { kind: "own_post" | "competitor_post" | "trend" | "comment" | "web" | "business"; id: string; url: string | null; summary: string }

export interface ScoreComponents { L: number | null; F: number; P: number; M: number; W: number; G: number }

export interface IdeaCard {
  idea_id: string; title: string; why_now: string; core_idea: string; platform: Platform | null; evidence: Evidence[];
  score: number; relative: Relative; confidence: Confidence; content_type: string; effort: "low" | "medium" | "high";
  risks: string[]; label: "proven" | "test"; features: Record<string, string>; score_components?: ScoreComponents;
  grounded?: boolean; campaign_id?: string | null; campaign_name?: string | null; campaign_phase?: string | null;
  planned_for?: string | null; objective_title?: string | null;
}

export interface Beat { t: string; beat: string; on_screen_text?: string; voiceover?: string }

export interface BriefPayload {
  schema: "brief.v1"; brief_id: string; idea_id: string; workspace_id: string; kind: "platform" | "general";
  platform?: Platform; format?: string; language: string; goal: Goal; core_idea: string; hooks: string[];
  structure?: Beat[]; visual_direction: { style: string; brand_colors: string[]; shots: string[] };
  script_or_copy?: string; caption: string; cta: { type: string; text?: string; url?: string };
  length_seconds?: [number, number] | null; aspect_ratio?: string; title?: string; thumbnail_brief?: string;
  messaging?: string[]; suggested_formats?: string[]; do_not: string[]; evidence_ids: string[];
  score: { relative: Relative; confidence: Confidence }; label: "proven" | "test"; created_at: string;
  optimization?: Optimization; product?: { name: string; url: string | null }; buyer_stage?: string;
  campaign?: { id: string; name: string; phase: string | null; objective: string | null };
  facts?: { id: string; text: string; url: string | null }[]; review_notes?: string[];
}

export type BriefStatus = "draft" | "queued" | "delivered" | "acknowledged" | "failed";

export interface BriefListItem {
  id: string; idea_id: string; kind: "platform" | "general"; platform: Platform | null; status: BriefStatus;
  created_at: string; delivered_at: string | null; title: string; label: "proven" | "test"; format: string | null; first_hook: string | null;
}

export interface BriefDetail { payload: BriefPayload; status: BriefStatus; created_at: string; delivered_at: string | null; idea_id: string; title: string }

export interface PostRow {
  id: string; platform: Platform; published_at: string; caption: string | null; permalink: string | null;
  link_status: "linked" | "suggested" | "confirmed" | "unmatched"; features: Record<string, string>;
  views: number | null; pi: number | null; goal_index: number | null; views_basis: "72h" | "backfill" | null;
  latest_views: number | null; idea_title: string | null; label: "proven" | "test" | null;
}

export interface Snapshot {
  offset_label: string; captured_at: string; views: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; sends: number | null; avg_watch_seconds: number | null; completion_rate: number | null;
  link_clicks: number | null; profile_visits: number | null; followers_gained: number | null;
}

export interface PostDetail {
  id: string; platform: Platform; platform_post_id: string; permalink: string | null; caption: string | null; published_at: string;
  features: Record<string, string>; link_status: string; match_confidence: number | null; pi: number | null; goal_index: number | null;
  baseline_views: number | null; views_72h: number | null; idea_id: string | null; idea_title: string | null; label: "proven" | "test" | null;
  score_components: ScoreComponents | null; brief_id: string | null; brief: BriefPayload | null; metric_curve: Snapshot[];
  autopsy: { body: { verdict: "beat_baseline" | "near_baseline" | "below_baseline"; summary: string; takeaway: string; cited_post_ids: string[] }; created_at: string } | null;
}

export interface Overview {
  headline: { platform: Platform; median_now: number | null; median_month_ago: number | null; p25_now: number | null; p25_month_ago: number | null; hit_rate_now: number | null; hit_rate_month_ago: number | null }[];
  rolling: { platform: Platform; week: string; median_views: number; p25_views: number; hit_rate: number | null; n: number }[];
  best_worst: { kind: "best" | "worst"; post_id: string; platform: Platform; published_at: string; pi: number; views: number }[];
  goal_trend: { platform: Platform; week: string; goal_index: number; n: string }[];
}

export interface Claim { text: string; post_ids: string[] }
export interface NextRule { platform: string; feature: string; value: string; action: "prefer" | "avoid" | "test"; share: number | null; rationale: string; post_ids: string[] }
export interface ReportBody { headline: string; what_worked: Claim[]; what_didnt: Claim[]; why: Claim[]; what_next: NextRule[]; nudges: string[] }
export interface ReportListItem { id: string; period_start: string; period_end: string; created_at: string; headline: string }
export interface ReportDetail { id: string; period_start: string; period_end: string; created_at: string; body: ReportBody; input_table: { posts?: { post_id: string; platform: string; pi: number | null; published_at: string }[] } }

export interface Learning {
  rules: { id: string; platform: string | null; feature: string; value: string; action: string; share: number | null; rationale: string; active_until: string | null }[];
  explore: { platform: Platform; explore_share: number; reason: string | null; updated_at: string }[];
  patterns: { platform: Platform; feature: string; value: string; n: number; mu_hat: number; se: number; p_beat: number; multiple: number }[];
}

export interface Match {
  id: string; platform: Platform; published_at: string; caption: string | null; permalink: string | null;
  match_confidence: number | null; brief_id: string | null; idea_title: string | null; brief_caption: string | null;
}

export interface Competitor { id: string; name: string; handles: Partial<Record<Platform | "website", string>> }
export interface Account { id: string; platform: Platform; handle: string | null; account_kind: string; connected_at: string; posts: number; last_metrics_day: string | null; followers: number | null }
export interface CostRow { task: string; model: string; calls: number; cost_usd: number; cache_read_tokens: number; input_tokens: number }

// --- Week 2: business knowledge, products, growth plan, campaigns -------------------

export interface SourceRow {
  id: string; domain: string; url: string; role: string; added_by: "user" | "auto" | "confirmed"; status: "active" | "pending_confirm" | "rejected";
  relation_score: number | null; relation_reasons: string[]; last_scanned_at: string | null;
}

export interface ScanPreview {
  scan_id: string; status: "preview" | "extracting" | "done" | "failed" | "cancelled";
  sources: { id: string; domain: string; role: string; added_by: string; status: string; reasons: string[]; pages: number }[];
  pending_sources: { id: string; domain: string; score: number; reasons: string[] }[];
  pages_found: number; pages_by_type: Record<string, number>; pages_selected: number; pages_to_read: number; pages_reused: number;
  unreadable: { url: string; reason: string }[]; est_tokens: number; est_cost_usd: number; quick_pages: number;
  pages_total: number; pages_done: number; cards_added: number; actual_cost_usd: number | null; error: string | null;
}

export interface ScanPage { id: string; url: string; page_type: string; priority: number; status: string; selected: boolean; title: string | null; tokens_est: number; up_to_date: boolean }

export const CARD_TYPES = [
  "product", "service", "feature", "pricing", "proof", "case_study", "testimonial", "client", "faq", "objection",
  "claim", "disclaimer", "audience", "differentiator", "process", "event", "news", "location", "person", "note",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export interface KnowledgeCard {
  id: string; type: CardType; title: string; body: string; attributes: Record<string, string>; product_ids: string[];
  sources: { kind: "page" | "upload" | "user" | "research"; ref: string; url: string | null; quote: string }[];
  status: "suggested" | "approved" | "rejected" | "stale"; confidence: "high" | "medium" | "low"; created_by: "ai" | "user";
  used_count: number; first_seen: string; last_verified: string;
}

export interface Product {
  id: string; name: string; kind: "product" | "service"; revenue_role: RevenueRole | null; status: "active" | "launching" | "seasonal" | "retired";
  origin: string; confirmed: boolean; summary: string | null; ai_summary: string | null; audience: string | null; price_text: string | null;
  url: string | null; source_domain: string | null; benefits: string[]; image_upload_ids: string[]; cards?: number;
}

export interface CoverageRow { product_id: string; product: string; confirmed: boolean; items: { key: string; label: string; count: number; question: string | null }[]; score: number }

export interface UploadRow {
  id: string; filename: string; mime: string; size_bytes: number; storage_path: string | null; status: "pending" | "uploaded" | "processed" | "failed";
  pages: number | null; cards_added: number; error: string | null; created_at: string;
}

export interface Objective {
  id: string; title: string; period_start: string | null; period_end: string | null; segment: string | null; product_ids: string[]; motion: string[];
  stage_messages: Record<string, string>; success_metric: string | null; target_value: number | null; current_value: number | null;
  weight: number; status: "active" | "done" | "paused"; ideas?: number; campaigns?: number;
}
export type ObjectiveInput = Omit<Objective, "id" | "ideas" | "campaigns">;

export const CAMPAIGN_GOALS = ["awareness", "leads", "sales", "launch", "event", "retention"] as const;
export interface Campaign {
  id: string; name: string; objective_id: string | null; objective_title?: string | null; goal: (typeof CAMPAIGN_GOALS)[number]; product_ids: string[];
  audience: string | null; key_message: string | null; offer: string | null; cta_text: string | null; cta_url: string | null;
  start_date: string | null; end_date: string | null; platforms: string[]; posts_per_week: number; phases: { name: string; stage: string; share: number }[];
  success_metric: string | null; target_value: number | null; current_value: number | null; knowledge_card_ids: string[];
  status: "draft" | "active" | "done"; ideas?: number; briefs?: number; posts?: number;
}
export type CampaignInput = Omit<Campaign, "id" | "objective_title" | "ideas" | "briefs" | "posts">;

export interface CampaignIdea extends IdeaCard { planned_for: string | null; status: string; brief_id: string | null }
export interface CampaignResults {
  posts: { id: string; platform: string; published_at: string; permalink: string | null; caption: string | null; phase: string | null; stage: string | null; pi: number | null; views: number | null }[];
  median_pi: number | null; beat_usual: number; by_phase: { key: string; posts: number; median_pi: number }[]; by_stage: { key: string; posts: number; median_pi: number }[];
}

export interface Acceptance { grounded: { shown: number; accepted: number; dismissed: number; rate: number | null }; starter: { shown: number; accepted: number; dismissed: number; rate: number | null } }

export interface Optimization {
  primary_keyword: string; secondary_keywords: string[];
  keyword_check?: { source: string; checked_at: string; region: string | null; top_results: { title: string; channel: string; views: number | null; url: string }[]; suggested_angle: string } | null;
  titles?: string[]; description?: string; chapters?: { t: string; title: string }[];
  thumbnails?: { concept: string; text: string; subject: string; layout: string; colors: string[] }[];
  thumbnail_spec?: { size: string; ratio: string; max_mb: number; safe_zone: string };
  caption_first_line?: string; on_screen_text?: string[]; spoken_keyword_line?: string; alt_text?: string; hashtags: string[]; tags?: string[];
  title_style: string; thumbnail_style?: string;
}
