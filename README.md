# Content Ideation Engine

Ideation, brief handoff, analytics and a learning loop for the content studio. This is the week-1 build of the
*Content Ideation Engine — Product Spec v2 (Zero-Cost Week 1)*.

**Zero cost except Claude:** data comes from official free APIs (through the accounts the studio already connects),
keyless public feeds and the studio's Supabase Postgres. There is no scraping and no paid vendor.

```
 1 Ideation engine ──▶ 2 Brief handoff ──▶ 3 RESERVED: content mgmt + scheduling
        ▲                                              │  (emits published_post)
        │                                              ▼
 5 Learning loop ◀──────────────────────── 4 Analytics: ingestion + reports
```

Every published post carries the `idea_id` and `brief_id` it came from. That link is what lets the loop learn.

**Week 2:** business knowledge from every site the brand owns (stored once, re-read only when it changes), products,
uploads, a growth plan, campaigns and platform optimisation in briefs. Specification: [docs/WEEK2_SPEC.md](docs/WEEK2_SPEC.md).

| Week 2 screen | What you do there |
| --- | --- |
| Knowledge → Websites | Scan every site you own: sitemap, menus and clearly-related domains (others are asked first). You see the page count and estimated cost before anything is read; unchanged pages are never read twice |
| Knowledge → Facts | Review what was found: one fact per card, each with the exact quote and link it came from. Approve, edit, merge or remove |
| Knowledge → Products & services | What you sell, its role (main revenue, secondary, lead magnet), price, link, audience, and its facts |
| Knowledge → Files | Upload brochures, price lists, decks and screenshots (PDF, images, text). PDFs are read in the browser; images are shrunk first |
| Knowledge → Gaps | What's missing per product, with one question per gap; and whether grounded ideas get picked more than starters |
| Plan → Growth plan | 2–4 business development objectives for the quarter (draft them with 5 questions); ideas are split by their weights |
| Plan → Campaigns | A dated push around products: describe it in one sentence, check the brief, then plan dated posts (problem → proof → objections → last call) |
| Brief → Search, titles and thumbnails | Keyword, a free YouTube "what already ranks" check, 3 titles and 3 thumbnail concepts for Test & Compare, description, chapters, hashtags within limits |

## The web app

`web/` is a React app (Vite, TypeScript, Tailwind, TanStack Query, Recharts). It's built into `public/` and served by
the same Vercel project as the API.

| Screen | What you do there |
| --- | --- |
| Welcome | Create a brand, or open the demo bakery in one click |
| Setup | Website, goal and language → AI-drafted Brand Brain you edit and confirm → competitors → your first ideas |
| This week | **Make this week's posts** (Autopilot) or pick from 5–10 Idea Cards: proven vs. test, "likely top third", evidence, and why each is ranked where it is |
| Refine | Type an idea: the verdict streams in, then a sharper version with 3 alternatives, then ready-to-shoot versions per platform |
| Briefs | What's with the studio, what's in production, drafts; each brief reads like a production doc with copy buttons and exports |
| Analytics | Typical post, floor and hit rate against a month ago; week-by-week chart; what's working; every post as "2.1× your usual"; a match inbox for posts published outside the studio |
| Reports | The weekly report; every claim links to the posts behind it; "what's next" is already applied |
| Settings | Brand Brain, competitors, accounts (disconnect deletes data), AI spend, workspace |

**Demo mode:** `POST /v1/demo` (the "Explore the demo" button) seeds a fictional bakery with 12 weeks of posts, run
through the real analytics. Everything is explorable without a Claude key or connected accounts.

**Sign-in is not built yet.** Set `AUTH_MODE=open` so the browser can call `/v1` without a token. Anyone with the URL
can then use the app, so keep the deployment URL private until auth lands. `AUTH_MODE=token` (the default) keeps
the studio-only API.

```bash
npm run dev          # API on :8787 (set AUTH_MODE=open in .env)
npm run web:dev      # web app on :5173, proxies /v1 to the API
```

## What's in the box

| Stage | Where | What it does |
| --- | --- | --- |
| Brand Brain | `src/ideation/brandBrain.ts` | Drafts a brain from the website (goal and language/locale set by the owner); the user confirms it |
| 1 Ideation | `src/ideation/*`, `src/ai/ideator.ts` | Ideator → Critic → opportunity score → explore/exploit shortlist. Three modes: **Autopilot**, **Give me ideas** (precomputed, a DB read), **Refine my idea** (streamed over SSE) |
| 2 Handoff | `src/handoff/*`, `src/contracts/brief.ts` | `brief.v1` JSON: one native brief per selected platform (adapters run in parallel), or one general brief when none is selected. Queue table + optional signed webhook; UTM tags carry the `brief_id` |
| 3 Reserved | `src/contracts/stage3.ts` | Only the contract: `generated_asset` in, `published_post` out. Analytics depends only on `published_post` |
| 4 Analytics | `src/analytics/*`, `src/providers/own/*` | Own-post metrics for TikTok, Instagram, Facebook, YouTube and LinkedIn; snapshots at 1 h / 6 h / 24 h / 72 h / 7 d / 28 d; performance index (PI), goal index, rolling median / p25 / hit rate; weekly AI report and a 72-hour post autopsy |
| 5 Learning | `supabase/migrations/0002_*`, `src/learning/*` | Shrunk log(PI) estimate per brand × platform × feature value (SQL view, k = 5); 80/20 exploit/explore with Thompson sampling; floor protection (explore drops to 10% after 2 falling weeks, returns after 2 recovering weeks); "what next" rules feed ideation |

Evidence and signals:

| Source | File | Key |
| --- | --- | --- |
| Instagram Business Discovery (competitors) | `src/providers/competitor/instagramBusinessDiscovery.ts` | user's connected professional account |
| YouTube Data API (competitors, comments, most popular) | `src/providers/competitor/youtube.ts`, `src/providers/signals/youtubeMostPopular.ts` | `YOUTUBE_API_KEY` (the one new key) |
| TikTok oEmbed (links the user pastes) | `src/providers/competitor/tiktokOembed.ts` | none |
| Google Trends "Trending now" RSS | `src/providers/signals/googleTrendsRss.ts` | none |
| Wikipedia pageviews | `src/providers/signals/wikipedia.ts` | none (User-Agent set) |
| Stack Exchange, Hacker News | `src/providers/signals/stackexchange.ts`, `hackernews.ts` | none |
| Comments on own posts and competitor YouTube videos | `src/signals/ingest.ts`, `src/competitors/ingest.ts` | via the above |

Every source sits behind the interfaces in `src/providers/types.ts` and is registered in `src/providers/registry.ts`,
so a paid vendor added later is one more registration. It adds data and replaces nothing.

## How the numbers work

- **Performance index:** `PI = views at 72 h / median(views at 72 h, same platform, previous 20 posts)`.
  It needs 3 earlier posts. Posts pulled in as history when an account connects get a single `backfill` snapshot
  (lifetime views). Those count toward the baseline, which makes it conservative, but they never get a PI of their own.
  The **goal index** does the same with the goal metric: link clicks for leads and sales, follows (or profile visits)
  for reach, and interactions for engagement.
- **Learning model** (`v_feature_estimates`): `mu_hat = (n·mean + k·mu_prior)/(n + k)` on log(PI), with k = 5.
  Priors come from `feature_priors`. An idea's estimate is `intercept + Σ(mu_hat − intercept)` over its feature
  values, where the intercept is the brand's mean log(PI). Features that appear on every post therefore add nothing,
  and neither do unseen values. `P(PI > 1) = Φ(mu/se)`. Exploit slots need at least 0.7.
- **Opportunity score:** `S = 100·(0.30 L + 0.25 F + 0.15 P + 0.10 M + 0.10 W + 0.10 G)`. Until a platform has
  5 posts with results, L's weight moves to P. The score is always shown as relative ("likely top third"), never as a
  virality percentage.
- **Reports:** all numbers are computed in code (`src/reports/tables.ts`). Claude only interprets them. Any claim
  that doesn't cite a real post id is dropped, and so is any "what next" rule on an unknown feature. The surviving
  rules go into `guidance_rules`, which ideation applies (for example, "2 of 3 reels open with a price reveal").

## Claude usage

All calls go through `src/ai/client.ts`:

- **Model tiering from config:** `MODEL_FAST` (default `claude-haiku-4-5`) handles the critic, adapters, verdicts,
  tagging and autopsies. `MODEL_STRATEGY` (default `claude-sonnet-5`) handles ideation, sharpening and weekly reports.
- **Prompt caching:** the Brand Brain, playbooks, feature vocabulary and rules form a fixed, deterministic prefix
  with a cache breakpoint.
- **Structured outputs:** `messages.parse` with zod schemas, then stricter contract validation (`brief.v1`).
- **Message Batches API** (50% price) for nightly vision tagging of competitor thumbnails and cover frames.
- **Cost guardrails:** every call writes a row to `cost_log`, and there's a per-workspace daily budget
  (`WORKSPACE_DAILY_BUDGET_USD`, returns HTTP 429). Also set a global monthly spend cap in the Claude Console.
  `GET /v1/workspaces/:ws/costs` returns measured spend.

## Setup

```bash
nvm use                      # Node 22
npm install
cp .env.example .env         # fill in DATABASE_URL, ANTHROPIC_API_KEY, YOUTUBE_API_KEY, API_TOKEN, STUDIO_* ...
npm run migrate              # optional: the app also applies migrations on start (pgvector and pg_trgm required)
npm run dev                  # API on :8787
npm run worker:dev           # job worker (nightly precompute, snapshots, reports)
```

### Deploy on Vercel

The API runs as one Vercel Function (`api/index.js` → the compiled Hono app), and the web app is static files in
`public/`. `/v1/*`, `/cron/*` and `/healthz` go to the function; every other path serves the web app. The
background worker becomes a cron route.

1. **Database first:** Vercel does not run migrations. From your machine, set `DATABASE_URL` to the Supabase
   connection string and run `npm run migrate`. You can also paste the two files in `supabase/migrations/` into
   the Supabase SQL editor, in order. Enable the `vector` extension if it isn't enabled yet.
2. **Import the repo in Vercel.** The framework preset is "Other". `vercel.json` sets the build command
   (`npm run vercel-build`) and the function settings.
3. **Environment variables** (Project → Settings → Environment Variables), see `.env.example`:
   - `DATABASE_URL`: use Supabase's **Session pooler** string (port 5432 on `*.pooler.supabase.com`), not the
     transaction pooler, because the app sets `search_path` per session.
   - `DB_POOL_MAX=3` (serverless functions should keep few connections).
   - `AUTH_MODE=open` while the web app has no sign-in (see "The web app" above), otherwise `API_TOKEN`: any long
     random string, sent as `Authorization: Bearer …` on every `/v1` call.
   - `CRON_SECRET`: a long random string. Vercel Cron sends it automatically.
   - `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, and optionally `MODEL_FAST`, `MODEL_STRATEGY`,
     `WORKSPACE_DAILY_BUDGET_USD`, `HTTP_USER_AGENT`.
   - `STUDIO_TOKEN_URL`, `STUDIO_API_TOKEN`, `STUDIO_WEBHOOK_URL`, `STUDIO_WEBHOOK_SECRET` once the studio side exists.
4. **Scheduling:** `/cron/tick` enqueues whatever recurring work is due and then runs queued jobs for up to 4 minutes.
   `vercel.json` schedules it once a day (02:10 UTC), because the Hobby plan only allows daily crons. For metric
   snapshots on time, either use Pro and change the schedule to `*/10 * * * *`, or point a free external cron
   (e.g. cron-job.org) at `GET https://<app>.vercel.app/cron/tick` every 10 minutes with the header
   `Authorization: Bearer <CRON_SECRET>`.
5. **While testing,** `POST /v1/jobs/run` (with `API_TOKEN`) runs queued jobs immediately. For example, confirm a
   Brand Brain, then call it to get the first Idea Cards without waiting for the nightly run.

Smoke test after deploying:

```bash
URL=https://<app>.vercel.app; T=<API_TOKEN>
curl $URL/healthz
curl -X POST $URL/v1/workspaces -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"studio_workspace_id":"demo","name":"Demo Bakery"}'
# -> {"workspace_id":"wsp_..."}; then PUT /v1/workspaces/wsp_.../brand-brain, POST /v1/jobs/run, GET /v1/workspaces/wsp_.../ideas
```

Studio-side, day 1:

1. Apply `supabase/studio/0001_studio_post_brief_link.sql` to the studio's own published-post table. Rename the
   table first.
2. Have the studio call `POST /v1/published-posts` at publish time with `brief_id` and `idea_id`.
3. Expose fresh OAuth tokens for connected accounts at `STUDIO_TOKEN_URL/{studio_connection_id}`
   → `{access_token, expires_at}`. Tokens never leave the studio's store.
4. Read briefs from `GET /v1/briefs?status=queued` (or `ideation.briefs`), or receive the signed webhook. Then
   `POST /v1/briefs/:id/ack`.
5. Optional: deploy the embeddings function (`supabase functions deploy embed`) and set `EMBED_URL`. Without it,
   white-space scoring and de-duplication fall back to lexical similarity.
6. Optional: on Supabase, schedule recurring jobs with `supabase/optional/pg_cron_schedule.sql` and run the worker
   with `WORKER_SCHEDULE=pg_cron`.

## API (Bearer `API_TOKEN`; the studio is the caller)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/workspaces` | Create or get the workspace for a studio workspace |
| POST | `/v1/workspaces/:ws/brand-brain/draft` | Draft from the website `{website_url, goal, language}` |
| PUT | `/v1/workspaces/:ws/brand-brain` | Confirm (and edit) the Brand Brain; kicks off the first precompute |
| POST | `/v1/workspaces/:ws/accounts` | Register a studio-connected account; backfills history |
| DELETE | `/v1/accounts/:id` | Disconnect, deleting that account's platform data |
| POST/GET/DELETE | `/v1/workspaces/:ws/competitors` | Up to 5 competitors, handles per platform |
| POST | `/v1/workspaces/:ws/tiktok-links` | Pasted TikTok link → oEmbed caption and cover |
| GET | `/v1/workspaces/:ws/ideas[?format=md\|csv\|json]` | **Give me ideas**: the precomputed shortlist (5–10 cards) |
| POST | `/v1/workspaces/:ws/autopilot` | **Make this week's posts**: top idea per connected platform, queued |
| POST | `/v1/workspaces/:ws/refine` | **Refine my idea** (SSE: `verdict_delta`, `verdict_done`, `ideas`, `platform_brief`, `done`) |
| POST | `/v1/ideas/:id/handoff` | `{platforms: [...]}` → platform briefs, or `[]` → one general brief |
| GET | `/v1/ideas/:id`, `/v1/ideas/:id/export?format=` | Card and export |
| GET | `/v1/briefs?status=queued&workspace_id=` | The studio's brief queue |
| POST | `/v1/briefs/:id/ack` | Studio acknowledges a brief (idempotent) |
| GET | `/v1/briefs/:id/export?format=md\|json\|csv` | Brief export |
| POST | `/v1/published-posts` | Stage-3 `published_post` intake |
| POST | `/v1/published-posts/:id/confirm-match` | User confirms or rejects a suggested match for an externally published post |
| GET | `/v1/workspaces/:ws/analytics/overview` | Rolling median, p25, hit rate, goal trend, best and worst posts |
| GET | `/v1/posts/:id` | Post detail: metric curve, PI, idea, brief, features, autopsy |
| GET | `/v1/workspaces/:ws/reports/latest` | Latest weekly report |
| GET | `/v1/workspaces/:ws/costs` | Claude spend by task, last 30 days |

The Idea Cards and analytics pages are studio routes on top of these endpoints (the spec puts the front end inside the
studio app). Use ECharts or Recharts for the charts.

## Jobs

| Job | When | Does |
| --- | --- | --- |
| `nightly` → `nightly_workspace` | 02:10 UTC | Trends RSS and YouTube charts per country; competitors; comments; pillar momentum; vision tagging (batch); ideate → critique → score → shortlist; Autopilot draft briefs; retention purge; playbook staleness warning |
| `run_due_snapshots` | every 10 min | Metric snapshots on schedule. Rate limits defer, they never drop |
| `refresh_performance` | after new snapshots | Refresh `mv_post_performance`, rescore shortlists (no Claude cost) |
| `autopsy` | 72 h snapshot taken | Post autopsy |
| `account_metrics` | 03:20 UTC | Followers, profile visits |
| `weekly_reports` | Sunday 18:05 UTC | Floor protection, weekly report, "what next" rules |
| `batch_poll` | after a batch is submitted | Collect Message Batches results |
| `deliver_brief` | on handoff | Signed webhook to the studio (when configured) |

## Tests

```bash
npm test                                   # unit tests (no database)
TEST_DATABASE_URL=postgresql://... npm run test:db   # integration tests: throwaway DB per file, needs pgvector
```

The integration tests check PI, baselines, rolling stats and the learning view against values computed in code.
They also run the whole loop end to end with a fake Claude client and a fake platform provider: precompute →
shortlist → autopilot → handoff → refine (SSE) → published post → rate-limited snapshot → PI → autopsy → weekly
report → rules → rescore, plus the guardrails (auth, 5-competitor cap, budget, deletion).

## Verify during app review (before real traffic)

The platform clients use each API's documented endpoints and fields. Metric names do change between Graph and API
versions, so confirm these against a real test account on day 2:

- **Instagram:** the per-type insights metric lists (`METRICS_BY_TYPE`), and whether Business Discovery returns
  `view_count`. There's an automatic fallback to likes + 2 × comments when it doesn't.
- **Facebook:** the post insight names in `POST_METRICS`. A 400 falls back to a minimal set.
- **LinkedIn:** the `memberCreatorPostAnalytics` query types and the `LinkedIn-Version` header (`LINKEDIN_VERSION`).
- **TikTok:** `follower_count` needs `user.info.stats`. Without it the field stays null, per the "never guessed" rule.
- **YouTube Analytics** lags 1–2 days, so early snapshots use real-time Data API counts.

## Still open (from the spec)

- Does the studio use the Instagram API with Facebook Login or with Instagram Login? Business Discovery needs
  Facebook Login.
- Is the studio's Supabase project on Free or Pro? Free pauses after 7 idle days, but the nightly job keeps it awake.
- Which 3–5 real brands will test on day 7?

Week-2 backlog (per the daily rule): paid data vendors, the scheduling block, comment-reply drafting, transcription
for posts made outside the studio, and cross-brand niche priors.
