# Week 2 Product Specification: Business Knowledge, Growth Plan, Campaigns and Platform Optimisation

Status: **built** (see §14 for where the build differs from this spec) · Date: 2026-09-26 · Builds on: the week-1 engine in this repo (ideation, briefs, analytics, learning loop, brand research, market scan).

## 0. Summary

Week 1 made ideas specific to a brand and able to learn from results. Week 2 gives the engine a **complete, lasting, sourced model of the business** and uses it everywhere:

1. **Find** everything a business publishes about itself: every page of every site it owns (not just the homepage), sister sites, and its documents.
2. **Store it once** as page snapshots and flexible **knowledge cards**, re-reading only what changed.
3. **Organise** it into products and services, a **growth plan** (business development objectives) and **campaigns**.
4. **Brief** every idea along the objective → campaign → product → buyer stage chain, with **platform optimisation** (YouTube titles, descriptions, chapters, thumbnail specs and test variants; keyword placement for Instagram and TikTok) grounded in the platforms' own documentation.
5. **Spend as little on the LLM as possible:** rules before AI, the batch discount, caching, retrieval, and never analysing the same content twice.

The product principle from the research document stays the same: a standing, evidence-grounded model of what a specific business should say next, which improves as results come in.

### Non-goals (this week)

- Auto-publishing, scheduling, a social inbox (studio stage 3).
- Generating thumbnail or video images (the studio makes assets; we specify them).
- Paid trend, keyword or listening data; scraping competitor posts outside official APIs.
- Website or blog SEO, and optimisation for AI answer engines.
- Sign-in (still `AUTH_MODE=open`).

---

## 1. Decisions (locked with the product owner)

| Topic | Decision |
|---|---|
| Crawl budget | Discover and fetch pages first (free), then **show the page count and an estimated cost before any AI reading**. The user confirms. |
| Related domains | **Crawl automatically when it is clearly the same brand** (score ≥ threshold, §3.1.3). Otherwise **ask** before crawling. |
| YouTube Data API | Key is set on Vercel as `YOUTUBE_API_KEY`. Used for the free "what already ranks" keyword check. |
| Original files | Kept in **Supabase Storage** (free tier: 1 GB, 50 MB per file). |
| Cost | Supabase, Vercel and Google APIs stay on free tiers. **The LLM is the only running cost and is minimised by design (§8).** |

---

## 2. User journeys

### 2.1 Onboarding scan (new brand)
1. Welcome → Setup: the user enters the **main website** and, optionally, **other sites** (product sites, shop, sister brands, link-in-bio page).
2. **Discover** (seconds, free): robots.txt → sitemaps → navigation and footer → related domains (auto or ask) → a page list, sorted by type.
3. **Fetch and clean** (under a minute, free): high-value pages are downloaded, the repeated header and footer text is removed, and each page is fingerprinted.
4. **Preview:** *"Found 57 pages on 2 sites. We'll read 38 that describe what you sell (products 14, services 9, case studies 6, FAQ 3, about 6). Estimated AI cost: about $0.12. First results in about a minute; the rest in the background."* Buttons: **Scan these** / **Choose pages** / **Skip**.
5. **Quick pass** (real time, about 1 minute): the homepage plus the top 8 pages are extracted immediately, so the Brand Brain review works as it does today.
6. **Background pass:** the remaining pages go through the Anthropic **batch discount (50% off)**. A banner says *"Still reading 30 pages… you can keep going."*
7. **Knowledge review:** cards grouped by product. The user approves, edits, merges or rejects them. The **coverage panel** shows gaps and asks one targeted question per gap.

### 2.2 Existing brand (for example Lordsway)
Settings → **Sources** → "Scan my sites". The same flow runs; existing Brand Brain facts are kept, and new cards come in as *suggested*.

### 2.3 Upload a document or image
Knowledge → **Add** → drop a PDF, image or screenshot, paste text, or paste a URL. The browser uploads straight to Supabase Storage using a signed upload URL, so there is no 4.5 MB Vercel limit. Cards are extracted, reviewed, and attached to products.

### 2.4 Plan the business development objectives
Plan → **Growth plan** → "Draft from my knowledge". The AI proposes 2–4 objectives for the quarter from the cards plus 5 short questions. The user edits and confirms.

### 2.5 Run a campaign
Plan → **New campaign** → one sentence, plus optional documents → the AI drafts the campaign brief (objective, products, audience, message, offer, call to action, dates, platforms, posting rate, success measure) → the user edits → **Plan it** produces a sequence of ideas across the dates → campaign ideas appear on This week with a tag → briefs carry the campaign context → results roll up on the campaign page.

### 2.6 Create a brief (with platform optimisation)
Unchanged entry point ("Create brief"). The brief now includes an **Optimisation** section per platform: YouTube gets a keyword check, 3 title/thumbnail variants for YouTube's Test & Compare, a description and chapters.

---

## 3. Features

### F1. Source discovery and crawl

#### 3.1.1 Sources
A **source** is a site the business owns: `{domain, role: primary | product_site | shop | sister_brand | link_in_bio | other, added_by: user | auto | confirmed, status}`. The primary site comes from setup; others are entered by the user or discovered (§3.1.3).

#### 3.1.2 Discovery order (no AI)
1. `robots.txt`: collect `Sitemap:` lines; **obey `Disallow`** for our user agent and `*`.
2. Sitemaps: `/sitemap.xml`, `/sitemap_index.xml`, plus any from robots. Follow indexes (max depth 2, max 2,000 URLs). Keep `<lastmod>`.
3. Homepage navigation, header, footer and in-content links (same domain).
4. Link-in-bio pages (linktr.ee and similar): read their outbound links as candidate sources.
5. Optional: up to 2 `site:` web searches to find unlinked product pages (a server tool; costs about $0.02; only if fewer than 5 product/service pages were found).

#### 3.1.3 Related-domain rule ("clearly the same brand")
A domain linked from the site is scored:

| Signal | Points |
|---|---|
| Linked from the source's header, navigation or footer | 2 |
| Footer, copyright or "a product of…" text on the other site names the source's brand or legal name | 3 |
| Same social profile URL(s) on both | 3 |
| Same contact email domain, phone number or street address | 2 |
| Same logo file (hash) or favicon | 2 |
| Brand name token shared in both domains | 1 |

**Score ≥ 5 → crawl automatically** (the user is told: *"Also scanning petrolord.com: its footer says it's a Lordsway Energy product"*). **Score 2–4 → ask** ("Is example.com part of your business?"). **Score below 2 → ignore.** Checks run on the other site's homepage only (one free fetch). The reason is stored and shown.

#### 3.1.4 Page sorting (rules, no AI)
From URL path, title, H1 and links:

| Type | Examples | Priority |
|---|---|---|
| product, service, solution, feature, pricing | `/products/x`, `/solutions/`, `/pricing` | High |
| case_study, testimonial, client | `/case-studies/`, `/clients` | High |
| faq, how_it_works | `/faq`, `/how-it-works` | High |
| about, team, industry, location | `/about`, `/industries/oil-gas` | Medium |
| blog, news, press | `/blog/…` | Low (the 5 newest only) |
| careers, legal, privacy, login, cart, tag and archive pages, search | — | Skipped |

Default budget: **up to 40 pages per site** (all High, then Medium, then the newest Low), adjustable in the preview. Pages over 2,500 tokens after cleaning are truncated with headings kept.

#### 3.1.5 Fetch and clean (no AI)
- Browser-like user agent, 8–12 s timeouts, per-host rate limit (≤ 2 requests per second), a 3-second cap on backoff.
- Clean: drop script, style, nav and footer; **strip boilerplate lines that appear on more than 50% of the site's pages** (menus, cookie banners, footers). This removes 30–60% of tokens on typical sites.
- Keep headings, lists, tables (as text), prices, `alt` text and JSON-LD (Product, Service, Organization, FAQPage are read directly as facts, with no AI).
- **Pages built only in JavaScript** (empty body after cleaning): mark as `unreadable`, use sitemap and meta data, and list them in the review ("paste this page's text or upload the brochure").

### F2. Page snapshots and change detection ("store once, never pay twice")

Every fetched page is a **snapshot**:

```
page_snapshots(id, workspace_id, source_id, url, page_type, priority, status: fetched|unreadable|skipped|blocked,
  etag, last_modified, sitemap_lastmod, content_hash, text, tokens_est, fetched_at, checked_at,
  extracted_hash, extracted_at, prompt_version)
```

Rules:
1. **Re-check** (weekly, and on "Re-scan"): send a conditional request (`If-None-Match` / `If-Modified-Since`). A **304** means no download and no AI.
2. If the body changed but `content_hash` (of the *cleaned* text) did not → no AI.
3. **AI extraction runs only when `content_hash ≠ extracted_hash` or `prompt_version` changed.** Results are keyed by `(content_hash, prompt_version)`, so identical pages across sites or workspaces reuse the extraction.
4. Sitemap `<lastmod>` older than `extracted_at` → skip fetching altogether.
5. Cards from a page whose content changed become `stale` until re-extracted; approved cards are never deleted automatically.
6. The same applies to other research: website analysis notes, the market scan (reused for 20 h), competitor research, and uploads (keyed by file hash).

### F3. Knowledge cards (flexible storage for messy information)

```
knowledge_cards(id, workspace_id, type, title, body, attributes jsonb, product_ids text[],
  sources jsonb  -- [{kind: page|upload|user|research, ref, url, quote}]
  status: suggested|approved|rejected|stale, confidence: high|medium|low,
  embedding vector(384), content_hash, first_seen, last_verified, used_count, created_by: ai|user)
```

**Types:** `product · service · feature · pricing · proof` (statistics, results) · `case_study · testimonial · client · faq · objection · claim` (approved marketing claim) · `disclaimer · audience · differentiator · process · event · news · location · person · note` (anything else).

- **`attributes`** keeps odd or structured facts without a schema change (`{"uptime":"99.5%","basin":"Niger Delta","certification":"ISO 9001"}`).
- **`note`** is the catch-all for unstructured information that doesn't fit a type yet. Nothing is thrown away.
- **Every card has at least one source with a verbatim quote.** Cards without a quote are rejected by validation.
- **Dedupe and merge:** a new card is compared against existing cards of the same type (cosine similarity ≥ 0.9 using embeddings; if `EMBED_URL` isn't set, trigram similarity ≥ 0.6 via `pg_trgm`). A match merges sources and bumps `last_verified` instead of adding a duplicate.
- **Lifecycle:**
  - `suggested` → user approves, or it's auto-approved after 14 days if it was never edited and has high confidence from the business's own site;
  - `approved` → used for ideas and briefs;
  - `stale` → shown in review until the source is re-read.
- **Coverage panel** (computed, no AI): per product, it checks for a description, price or pricing model, proof points, FAQs, objections, audience and a case study, and shows ✓ or "missing: add one" with a one-line question.

### F4. Uploads

- The browser asks `POST /v1/workspaces/:ws/uploads` for a **Supabase signed upload URL**, then uploads the file directly (bucket `ideation-uploads`, private; path `ws/{ws}/{sha256}.{ext}`).
- Allowed: PDF, PNG, JPG, WebP, TXT/MD, DOCX (converted to text in the browser with a small library, or rejected with "export as PDF"). Up to 50 MB (Supabase free tier cap).
- **The file hash identifies it:** re-uploading the same file reuses the existing cards.
- **The cheapest way to read each file:**
  - **PDF with a text layer:** text is extracted in the browser with pdf.js (free) and sent as text.
  - **Scanned or image-heavy PDF:** sent to Claude as a document, up to 20 pages per call; larger ones are split.
  - **Images:** downscaled in the browser to 1280 px on the long side (about 1,200 tokens) before extraction.
- The original is kept for the studio (product photos, brochures) and can be linked from briefs.

### F5. Products and services

Products get their own records (migrated from `brand_brains.offers`; `offers` stays as a read view for compatibility):

```
products(id, workspace_id, name, kind: product|service, revenue_role: core|secondary|lead_magnet,
  status: active|launching|seasonal|retired, summary, audience, price_text, url, source_domain,
  benefits text[], image_upload_ids text[], created_at, updated_at)
```

A product's proof, FAQs, objections, claims and disclaimers are **cards linked to it**, not columns. The product page shows them grouped, with coverage.

- **Created from cards:** a `product` or `service` card on a product page proposes a product; the user accepts it.
- **Summary (cached):** a short summary of about 120 words per product, regenerated only when its approved cards change (Haiku). Ideation reads summaries, not every card.

### F6. Growth plan (business development objectives)

```
objectives(id, workspace_id, title, period_start, period_end, segment, product_ids text[],
  motion text[]  -- e.g. ["assessment","pilot","contract"]
  stage_messages jsonb -- {awareness, consideration, decision}: message + proof card ids
  success_metric, target_value, current_value, weight numeric, status: active|done|paused)
```

- **Drafting:** one strategy-tier call over product summaries, the Brand Brain and 5 answers:
  1. What must happen for the business this quarter?
  2. Who are the target customers?
  3. Which products matter most?
  4. What's the usual path from first contact to a sale?
  5. How will you know it worked?

  It proposes 2–4 objectives, and the user edits them.
- **Weights** set the weekly idea mix (for example 50 / 30 / 20). Ideas with no objective are allowed, but capped at 20%.
- `current_value` is entered by hand this week; CRM and website conversion tracking are deferred.

### F7. Campaigns

```
campaigns(id, workspace_id, objective_id, name, goal: awareness|leads|sales|launch|event|retention,
  product_ids text[], audience, key_message, offer, cta_text, cta_url, start_date, end_date,
  platforms text[], posts_per_week int, phases jsonb, success_metric, target_value, current_value,
  knowledge_card_ids text[], status: draft|active|done)
```

- **Draft from one sentence:** Haiku structured call → campaign fields, pre-filled from the linked products' cards.
- **Plan:** one strategy-tier call → a **phased sequence**: tease (awareness) → launch → proof (consideration) → objections (decision) → last call. Slots are spread across dates × platforms × posting rate. Each slot is a normal idea row with `campaign_id`, `objective_id`, product, stage and a phase label, scored like any idea.
- **This week:** campaign ideas carry a tag and an "In campaign" filter; the week's mix respects active campaigns first.
- **Brief:** campaign fields plus linked cards go into the brief context; the call to action links to the campaign's `cta_url`.
- **Results:** posts link through brief → idea → campaign. The campaign page shows posts against the usual, stage and angle performance, and progress to target.
- **Learning:** `campaign_phase` is a learnable feature.

### F8. Platform optimisation in briefs (validated against platform documentation)

`brief.v1` gains an **optional** `optimization` object (backwards compatible):

```jsonc
"optimization": {
  "primary_keyword": "digital oilfield Nigeria",
  "secondary_keywords": ["production monitoring", "well surveillance"],
  "keyword_check": { "source": "youtube_data_api", "checked_at": "…", "top_results": [{ "title": "…", "views": 12000 }], "suggested_angle": "…" },
  "titles": ["…", "…", "…"],                       // YouTube: up to 3 for Test & Compare
  "description": "…",                              // YouTube: keyword in the first lines, links
  "chapters": [{ "t": "00:00", "title": "…" }],    // ≥3, first 00:00, each ≥10 s
  "thumbnails": [{ "concept": "…", "text": "≤4 words", "subject": "…", "colors": ["#…"], "layout": "…" }], // up to 3
  "thumbnail_spec": { "size": "1280x720", "ratio": "16:9", "max_mb": 2, "safe_zone": "keep text out of bottom-right" },
  "caption_first_line": "…",                       // Instagram, TikTok, LinkedIn: keyword early
  "on_screen_text": ["…"], "spoken_keyword_line": "…", "alt_text": "…",
  "hashtags": ["…"],                               // at most 3-5 (Instagram), 5 (TikTok), 3 (LinkedIn)
  "tags": ["common misspellings only"]             // YouTube
}
```

**Per-platform rules (from the sources in §12):**

| Platform | Rule | Evidence |
|---|---|---|
| YouTube | Relevance comes from the title, tags, description and video content; then engagement | YouTube, *How YouTube Works: Search* |
| YouTube | Tags play a *minimal role*; use them for common misspellings | YouTube Help: tags |
| YouTube | Custom thumbnails: 90% of best-performing videos use them; 1280×720, 16:9, ≤ 2 MB | YouTube Help: thumbnail tips; size guides |
| YouTube | Test & Compare: up to 3 titles or thumbnails; winner by watch-time share → we supply 3 variants | YouTube Help: A/B test |
| YouTube | Chapters: first 00:00, at least 3, each at least 10 s | YouTube Help: chapters |
| Instagram | Caption keywords are stronger signals than hashtags; alt text and on-screen text count; public professional posts are indexable by Google since July 2025 | Mosseri statements, industry summaries |
| TikTok | Captions, on-screen text and spoken words are read for search; saves weigh heavily | TikTok SEO studies |
| LinkedIn | Keyword in the opening lines only; no evidence post keywords drive reach → minimal treatment | — |

- **Keyword check (YouTube only, free):** `search.list` costs 100 of the 10,000 daily quota units, so about 100 checks a day per Google project. Results are cached for 7 days per keyword. Run once per YouTube brief; skipped when the quota is exhausted (the brief still ships).
- **Learnable features added:** `title_style` (question, number, how-to, statement, contrarian), `thumbnail_style` (face, product, text-heavy, before/after, diagram), `keyword_in_title` (yes/no). The existing loop learns which styles win *for this brand*.

### F9. Grounded ideation and briefs

- **Retrieval:** for each ideation run or brief, select up to 20 approved cards. Filtered by active campaign and objective products, then ranked by embedding similarity to the objective, campaign and pillar plus `last_verified`. They're added to the prompt as an evidence table (`card_id | type | product | fact | source`).
- **Figures rule:** numbers, prices, client names and claims in ideas and briefs must come from a cited card. The critic rejects uncited figures, and the brief validator strips them.
- **Label:** every idea shows **Grounded** (cites ≥ 1 card, moment or market item) or **Starter** (Brand Brain only). Acceptance rate is tracked per label; this is the research document's key test.
- Evidence kind `business` is added (card and upload citations link to the source URL or file).

### F10. Cost preview and controls
- **Scan preview:** the page count per type and an estimated cost before any AI reading (§7.1 formula). Scans over $1 need an explicit confirm.
- **Cost log:** every AI call already logs its cost. The Settings → AI spend page gains a breakdown by feature (scan, ideas, briefs, campaigns, research).
- The **workspace daily budget** (existing guard) applies to all new features. Background passes pause, rather than fail, when it's reached.

---

## 4. Data model (migration `0005_knowledge.sql`)

New tables: `sources`, `page_snapshots`, `extractions` (content_hash + prompt_version → JSON result, shared), `knowledge_cards`, `uploads`, `products`, `objectives`, `campaigns`, `scan_runs` (status, counts, estimate, actual cost).

Changes:
- `ideas` gains `campaign_id`, `objective_id`, `product_id`, `grounded boolean`.
- `briefs.payload.optimization` (JSON, no column needed).
- `pg_trgm` extension for fallback similarity.

RLS is enabled on every new table (same pattern as 0003).

---

## 5. API (all under `/v1/workspaces/:ws`)

| Method | Path | Purpose |
|---|---|---|
| GET/POST/PATCH | `/sources`, `/sources/:id` | List, add or confirm sources (`confirm` for ask-first domains) |
| POST | `/scans` | Discover + fetch + clean → returns preview `{pages_by_type, pages_to_read, est_tokens, est_cost_usd, unreadable}` |
| POST | `/scans/:id/start` | Quick pass now, the rest via batch; `{page_ids?}` to choose pages |
| GET | `/scans/:id` | Progress, actual cost |
| GET/PATCH | `/cards`, `/cards/:id` | Filter by type, product, status; approve, edit, merge, reject |
| GET | `/coverage` | Gaps per product and a question per gap |
| POST | `/uploads` → `/uploads/:id/process` | Signed upload URL, then extraction |
| CRUD | `/products` | Products and services |
| POST | `/growth-plan/draft`; CRUD `/objectives` | Objectives |
| POST | `/campaigns/draft`; CRUD `/campaigns`; POST `/campaigns/:id/plan` | Campaigns |
| GET | `/campaigns/:id/results` | Campaign performance |

Existing endpoints are unchanged. Each long step keeps within the hosting time limit (the staged pattern from week 1).

---

## 6. Screens

- **Setup:** the website step gains "Other sites (optional)"; after the Brand Brain review comes a **Scan preview** step (counts, cost, Choose pages), and background progress appears on later steps.
- **Knowledge** (new nav item):
  - tabs for Cards (grouped by product; approve, edit, merge), Sources (sites, related-domain decisions with reasons, unreadable pages), Uploads, and Coverage;
  - filters by type and status; bulk approve.
- **Products:** list and detail (summary, role, price, benefits, and linked cards by type, with coverage).
- **Plan** (new nav item): Growth plan (objectives with weights and progress) · Campaigns (list, create, plan, results).
- **This week:** Grounded/Starter label; campaign tag and "In campaign" filter; objective mix line.
- **Brief detail:** Optimisation section (keyword check, 3 titles and thumbnails, description, chapters, per-platform keyword placement), with copy buttons.
- **Settings → AI spend:** breakdown by feature; scan history with estimated vs actual cost.

---

## 7. Cost model

Prices used (per million tokens): **Haiku 4.5 $1 in / $5 out; Sonnet 5 $2 / $10; batch −50%; cache reads 10% of input.** Estimates are validated against the real `cost_log` after the first scans, and this table is updated.

### 7.1 First site scan (typical 40-page site)

| Step | Model | Tokens | Cost |
|---|---|---|---|
| Discovery, fetch, clean, sort, JSON-LD | none | 0 | **$0** |
| Quick pass: 9 pages × about 2,000 tokens, real time | Haiku | 18k in / 6k out | $0.018 + $0.030 = **$0.05** |
| Background: 31 pages, batch, 4 pages per request, cached instructions | Haiku (batch) | 62k in / 19k out | $0.031 + $0.047 = **$0.08** |
| Product summaries (about 8), card merge | Haiku | 12k in / 3k out | **$0.03** |
| **Total, one 40-page site** | | | **≈ $0.15** (range $0.10–$0.25) |
| Lordsway + Petrolord (about 60 pages) | | | **≈ $0.20–$0.35** |
| Weekly re-check (unchanged pages) | none | 0 | **$0** |
| Re-check with 5 changed pages | Haiku (batch) | | **≈ $0.01** |

Preview formula shown to the user: `est = Σ(page tokens) × 1.15 × in_price + pages × 600 × out_price` (batch price for the background share). Uploads: a 10-page text PDF costs about $0.01–0.02; a scanned 10-page PDF about $0.03–0.05; an image under $0.01.

### 7.2 Running cost per workspace (estimate, validated against the log)

| Activity | Frequency | Approximate / month |
|---|---|---|
| Nightly ideas (ideator Sonnet + critic Haiku), **moved to batch** | daily | $1.00–1.50 (was about $2.10 real-time) |
| Market scan (web search capped at 4 searches, reused for 20 h) | twice a week, plus on-demand | $0.80–1.20 |
| Briefs (Haiku adapters) | about 40 | $0.40 |
| Weekly report (Sonnet) | weekly | $0.20 |
| Campaign plans | about 2 | $0.10–0.20 |
| Knowledge re-checks | weekly | about $0.05 |
| **Total** | | **≈ $2.50–3.50 per workspace per month** |

---

## 8. LLM cost reduction (built into every feature)

1. **Rules before AI:** discovery, sorting, cleaning, JSON-LD parsing, related-domain scoring and coverage all run without AI.
2. **Boilerplate stripping:** lines repeated across most pages are removed before any token is sent.
3. **Never twice:** conditional re-fetch, content fingerprints, and extraction results keyed by fingerprint + prompt version and shared across workspaces.
4. **Cheapest adequate model:** Haiku for extraction, summaries, campaign drafts, briefs and the critic. Sonnet only for ideation, growth-plan and campaign-plan reasoning.
5. **Batch discount (50%):** background scans, nightly ideation, vision tagging and weekly reports. Real time only when a person is waiting.
6. **Prompt caching:** stable prefixes (role, Brand Brain, playbooks, extraction schema) first and cached; variable content last.
7. **Retrieval, not dumping:** at most 20 relevant cards and cached product summaries per prompt, never whole sites.
8. **Output discipline:** tight `max_tokens`; structured outputs refer to ids instead of repeating text.
9. **Free data first:** the YouTube Data API and Google Trends are used before any LLM web search; market-scan web search is capped at 4 searches and reused for 20 h; skipped for low-news industries (none found last time → next scan in 3 days).
10. **Browser pre-processing:** PDF text extraction and image downscaling happen on the user's device.
11. **On demand only:** briefs are written when chosen; Autopilot drafts only the top idea per platform.
12. **Guards:** the per-workspace daily budget, a scan preview with confirmation, and a cost breakdown per feature so the next cut is data-driven.

---

## 9. Environment variables (Vercel)

| Variable | Status | Use |
|---|---|---|
| `YOUTUBE_API_KEY` | **Set** | Keyword check (and existing YouTube sources) |
| `SUPABASE_URL` | **New** | Storage API base, e.g. `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **New, secret** | Server-only; creates signed upload URLs and reads files. Never sent to the browser. |
| `UPLOAD_BUCKET` | Optional | Defaults to `ideation-uploads` (created automatically if missing) |
| `EMBED_URL` / `EMBED_API_KEY` | Optional | Embeddings for merging and retrieval; without them the fallback is trigram similarity |

---

## 10. Build plan

| Day | Scope | Acceptance test |
|---|---|---|
| 1 | Migration 0005; sources; robots and sitemap discovery; related-domain scoring (auto ≥ 5 / ask 2–4); fetch, clean, boilerplate strip; snapshots with conditional re-fetch; scan preview API and UI | Lordsway + Petrolord mapped automatically (with the reason shown); preview shows counts and cost; an immediate re-scan performs 0 AI calls |
| 2 | Extraction (quick pass + batch), card schema and validation (quotes required), merging, Knowledge screen, coverage panel | ≥ 80 cards, each with a source quote; duplicates merged; cost within ±30% of the preview |
| 3 | Uploads (Supabase signed URLs, pdf.js, image downscale, scanned-PDF path), products migration and product pages, cached summaries | A brochure PDF produces cards on the right products; re-uploading the same file costs $0 |
| 4 | Growth plan (draft + objectives + weights); campaigns (draft from a sentence, plan, tags on This week, brief context) | Objective → campaign → about 12 sequenced ideas with phases, products and stages |
| 5 | Brief `optimization` block; YouTube keyword check (quota and 7-day cache); 3 title/thumbnail variants; chapters; per-platform keyword rules; new learnable features; playbook updates | Every YouTube brief has test-ready variants and valid chapters; quota exhaustion degrades gracefully |
| 6 | Retrieval into ideation and briefs; figures rule in the critic and brief validator; Grounded/Starter label; acceptance tracking; nightly ideation moved to batch | No brief contains an uncited figure; grounded vs starter acceptance is visible |
| 7 | Demo data (products, cards, objective, campaign); end-to-end browser tests; cost audit (estimated vs actual); mobile pass; README | Full journey passes on desktop and phone; cost table in §7 updated from real logs |

Carried to week 3: Moments inbox and share-from-phone, reasons on "Not for us" feeding the ranking, website and CRM conversion tracking for objectives.

---

## 11. Deferred, with reasons

| Item | Why not now |
|---|---|
| YouTube tag generation beyond misspellings | YouTube documents a minimal role for tags |
| Hashtag generators | Instagram's head says hashtags don't drive reach; we cap the count instead |
| Paid keyword and trend tools | Cost; the free YouTube API, Google Trends and the market scan cover the core need |
| AI thumbnail images | Cost; the studio produces assets from our specs |
| Rendering JavaScript-only sites in a headless browser | Hosting cost and time limits; fall back to sitemap, meta, paste or upload |
| Website/blog SEO and AI-answer optimisation | Outside social scope |
| Competitor scraping outside official APIs | Terms-of-service risk (as in week 1) |

## 12. Sources

- How YouTube Works, Search: https://www.youtube.com/intl/ALL_en/howyoutubeworks/product-features/search/
- YouTube Help, how search works: https://support.google.com/youtube/answer/16090438
- YouTube Help, tags: https://support.google.com/youtube/answer/146402
- YouTube Help, A/B test titles and thumbnails: https://support.google.com/youtube/answer/16391400
- YouTube Help, thumbnail and title tips: https://support.google.com/youtube/answer/12340300
- YouTube Help, video chapters: https://support.google.com/youtube/answer/9884579
- Thumbnail size guide: https://vidiq.com/blog/post/youtube-thumbnail-size-measurements/
- YouTube Data API quota: https://developers.google.com/youtube/v3/getting-started
- Instagram search and keywords: https://www.kontentino.com/q-and-a/instagram-search-seo/ · https://www.phable.io/phable-labs/instagram-hashtags-keywords-discovery
- TikTok SEO statistics: https://riseatseven.com/blog/tiktok-seo-statistics/
- Sitemaps and robots.txt: https://rankai.ai/articles/sitemap-and-robots-txt-best-practices
- Vercel function payload limit (4.5 MB): https://vercel.com/docs/functions/limitations
- Supabase Storage limits: https://supabase.com/docs/guides/storage/uploads/file-limits
- B2B LinkedIn content: https://www.310creative.com/blog/linkedin-content-marketing
- Research document: *AI Content Ideation Engine — 10-Phase Research Report* (2026-09-26)

## 13. Risks

- **Sites that block bots or need JavaScript:** mitigated by fallbacks, and shown to the user rather than hidden.
- **Related-domain false positives:** scoring is conservative, with a visible reason and one-click removal.
- **Batch latency** (usually minutes, up to 24 h): the quick pass keeps onboarding interactive.
- **Extraction quality on messy pages:** quotes are required, and cards are reviewed before first use.
- **YouTube quota:** cached per keyword; the check is skipped (not failed) when quota is exhausted.
- **Supabase free project pauses after 7 days of inactivity:** uploads fail gracefully with a "storage is paused" message.

## 14. As built: differences from this spec

- **Figures rule in briefs:** numbers a brief uses that aren't in the knowledge or the idea's evidence are **flagged** at the top of the brief ("Check before publishing") rather than silently removed; deleting a number mid-sentence can change its meaning. Ideas themselves are held to the rule in the prompt and the critic.
- **Nightly ideation and batch:** Vercel Hobby runs the cron once a day, so a two-stage batch (ideas, then critic) would deliver the next day's ideas a day late. Instead, nightly generation is **skipped for workspaces nobody has opened in 3 days** while they still have 5+ fresh ideas (no quality loss, often a larger saving). Batch is used for the background part of site scans, and the scan page collects results while it's open (the daily cron is the fallback).
- **Scan progress** is driven by the page: while it's open it checks the batch every 15 s.
- **Campaign scheduling:** fixed weekday patterns (3 a week = Mon/Wed/Fri; 2 = Tue/Thu), capped at 24 posts per plan.
- **Setup** gained a step, "Your products" (the scan), between the Brand Brain review and competitors.
- **Scan cost** in tests: a 17-page, 2-site scan, previewed, read and re-scanned: the re-scan made zero model calls.
- **Sites built with JavaScript** (React/Vite/Lovable, Next.js, Nuxt) send empty pages to a plain fetch. When the homepage is an empty app shell, the scan reads the site's words from its own code at no cost: page data embedded as JSON (`__NEXT_DATA__`, Next's streamed payload, `__NUXT__`, `<noscript>`), and readable sentences in up to 4 same-site script files (code, CSS class names and library messages are filtered out). The text becomes up to 6 "Site text" pages that the AI reads like any other page, and outside links found in the code (a sister product site) go through the related-domain check. Website analysis in Setup uses the same fallback.
- **Web research speed:** research uses the basic web search and fetch tools (no code-execution filtering step), low effort, 5 searches, and streams its answer so notes written before a time limit are kept. Time limits: brand research 200 s, competitor research 170 s (+40 s to structure).
