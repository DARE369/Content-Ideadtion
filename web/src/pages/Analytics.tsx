import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, Check, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { LabelBadge, PiBadge, PlatformBadge, Segmented } from "../components/bits";
import { TrendChart } from "../components/charts";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, ErrorNote, PageHeader, SectionTitle, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { change, FEATURE_NAMES, featureValue, num, pct, PLATFORM_META, relativeTime, shortDate } from "../lib/format";
import type { Platform } from "../lib/types";
import { useSummary, useWs } from "../lib/workspace";

function Kpi({ label, value, now, before, kind = "ratio", help }: {
  label: string; value: string; now: number | null | undefined; before: number | null | undefined; kind?: "ratio" | "points"; help: string;
}) {
  const c = change(now, before, kind);
  const Icon = c?.dir === "up" ? ArrowUpRight : c?.dir === "down" ? ArrowDownRight : Minus;
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className={`mt-1 flex items-center gap-1 text-xs ${c?.dir === "up" ? "text-good" : c?.dir === "down" ? "text-bad" : "text-ink-3"}`}>
        {c ? <><Icon className="size-3.5" aria-hidden />{c.text}</> : "Not enough history for a comparison yet"}
      </p>
      <p className="mt-3 text-xs text-ink-3">{help}</p>
    </Card>
  );
}

export function Analytics() {
  const ws = useWs();
  const summary = useSummary();
  const overview = useQuery({ queryKey: ["ws", ws, "overview"], queryFn: () => api.overview(ws) });
  const posts = useQuery({ queryKey: ["ws", ws, "posts"], queryFn: () => api.posts(ws) });
  const learning = useQuery({ queryKey: ["ws", ws, "learning"], queryFn: () => api.learning(ws) });
  const available = [...new Set((overview.data?.headline ?? []).map((h) => h.platform))];
  const [platform, setPlatform] = useState<Platform | null>(null);
  const p = platform && available.includes(platform) ? platform : available[0] ?? null;
  const { hash } = useLocation();
  useEffect(() => { if (hash === "#matches") document.getElementById("matches")?.scrollIntoView(); }, [hash, summary.data]);

  if (overview.isLoading) return <><PageHeader title="Analytics" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div><Skeleton className="mt-6 h-72" /></>;
  if (overview.isError) return <><PageHeader title="Analytics" /><ErrorNote error={overview.error} onRetry={() => overview.refetch()} /></>;

  const head = overview.data!.headline.find((h) => h.platform === p);
  const rolling = overview.data!.rolling.filter((r) => r.platform === p).map((r) => ({ ...r, hit_rate: r.hit_rate }));
  const bw = overview.data!.best_worst.filter((b) => b.platform === p);
  const platformPosts = (posts.data ?? []).filter((x) => x.platform === p);
  const explore = learning.data?.explore.find((e) => e.platform === p);
  const patterns = (learning.data?.patterns ?? []).filter((x) => x.platform === p);

  return (
    <>
      <PageHeader title="Analytics" subtitle="Every post is compared with your own usual results, never someone else's." />

      {!!summary.data?.pending_matches && <MatchInbox />}

      {!p ? (
        <EmptyState icon={<BarChart3 className="size-8" />} title="No results yet">
          {summary.data?.platforms.length
            ? "Results appear 72 hours after your first posts go live. Your first insights arrive after 3 posts on a platform."
            : "Connect your accounts in your content studio. Recent posts are pulled in automatically, so you'll have a baseline from day one."}
        </EmptyState>
      ) : (
        <>
          {available.length > 1 && (
            <div className="mb-5">
              <Segmented label="Platform" value={p} onChange={setPlatform} options={available.map((x) => ({ value: x, label: PLATFORM_META[x].name }))} />
            </div>
          )}

          <section aria-labelledby="kpi-heading" className="mb-8">
            <h2 id="kpi-heading" className="sr-only">Headline numbers</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi label="Your typical post" value={num(head?.median_now)} now={head?.median_now} before={head?.median_month_ago}
                help="Views at 72 hours: the middle of your last 10 posts. This is the number to grow." />
              <Kpi label="Your floor" value={num(head?.p25_now)} now={head?.p25_now} before={head?.p25_month_ago}
                help="Your weaker posts (bottom quarter of the last 10). A rising floor means bad weeks are less bad." />
              <Kpi label="Beating your usual" value={pct(head?.hit_rate_now)} now={head?.hit_rate_now} before={head?.hit_rate_month_ago} kind="points"
                help="Share of your last 10 posts that beat your usual views." />
            </div>
          </section>

          <Card as="section" className="mb-8 p-5">
            <SectionTitle>Week by week</SectionTitle>
            {rolling.length < 2 ? (
              <p className="py-8 text-center text-sm text-ink-2">A trend line appears after two weeks of results.</p>
            ) : (
              <TrendChart title={`Typical post and floor by week on ${PLATFORM_META[p].name}`} data={rolling} x="week"
                series={[{ key: "median_views", name: "Typical post", color: "--c-series-1" }, { key: "p25_views", name: "Floor", color: "--c-series-2" }]} />
            )}
            {explore?.reason && <p className="mt-4 rounded-lg bg-test-soft px-3 py-2 text-sm text-test">{explore.reason}</p>}
          </Card>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card as="section" className="p-5">
              <SectionTitle>Best and worst this month</SectionTitle>
              {bw.length === 0 ? <p className="text-sm text-ink-2">Nothing in the last 28 days yet.</p> : (
                <ul className="flex flex-col gap-1">
                  {[...bw.filter((b) => b.kind === "best"), ...bw.filter((b) => b.kind === "worst")].map((b) => {
                    const row = platformPosts.find((x) => x.id === b.post_id);
                    return (
                      <li key={b.kind + b.post_id}>
                        <Link to={`/analytics/posts/${b.post_id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                          <span className={`w-10 text-xs font-medium ${b.kind === "best" ? "text-good" : "text-bad"}`}>{b.kind === "best" ? "Best" : "Worst"}</span>
                          <span className="min-w-0 flex-1 truncate text-sm">{row?.caption ?? shortDate(b.published_at)}</span>
                          <PiBadge pi={b.pi} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card as="section" className="p-5">
              <SectionTitle aside={explore && <span className="text-xs text-ink-3">{Math.round(explore.explore_share * 100)}% of ideas are tests</span>}>What's working for you</SectionTitle>
              {patterns.length === 0 ? (
                <p className="text-sm text-ink-2">Patterns show up once a few posts share a feature, like an opener or format.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {patterns.slice(0, 6).map((x) => (
                    <li key={x.feature + x.value} className="flex items-center gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate"><span className="text-ink-3">{FEATURE_NAMES[x.feature] ?? x.feature}:</span> <span className="font-medium">{featureValue(x.feature, x.value)}</span></p>
                        <p className="text-xs text-ink-3">{Math.round(x.p_beat * 100)}% chance to beat your usual · {x.n} post{x.n === 1 ? "" : "s"}</p>
                      </div>
                      {x.p_beat >= 0.7 ? <BadgeCheck className="size-4 text-good" aria-label="Proven" /> : x.p_beat <= 0.3 ? <span className="text-xs text-bad">Weak</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <section aria-labelledby="posts-heading">
            <SectionTitle><span id="posts-heading">All {PLATFORM_META[p].name} posts</span></SectionTitle>
            {posts.isLoading ? <Skeleton className="h-64" /> : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {platformPosts.map((x) => (
                  <li key={x.id}>
                    <Link to={`/analytics/posts/${x.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <span className="w-14 shrink-0 text-xs text-ink-3">{shortDate(x.published_at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{x.caption ?? "Untitled post"}</span>
                        <span className="block truncate text-xs text-ink-3">
                          {x.features.hook_type ? `${featureValue("hook_type", x.features.hook_type)} opener` : ""}{x.idea_title ? ` · from "${x.idea_title}"` : ""}
                        </span>
                      </span>
                      <span className="hidden w-20 text-right text-sm tabular-nums sm:block">{num(x.views ?? x.latest_views)}</span>
                      <span className="hidden md:block"><LabelBadge label={x.label} /></span>
                      {x.views_basis === "72h" ? <PiBadge pi={x.pi} /> : <span className="text-xs text-ink-3">{x.views_basis === "backfill" ? "History" : "Collecting"}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-3">"2.1× · above usual" means 2.1 times the middle of your previous 20 posts on this platform, measured at 72 hours.</p>
          </section>
        </>
      )}
    </>
  );
}

function MatchInbox() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const matches = useQuery({ queryKey: ["ws", ws, "matches"], queryFn: () => api.matches(ws) });
  const decide = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api.confirmMatch(id, accept),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: v.accept ? "Linked. It now counts toward learning." : "Got it, not a match." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  if (!matches.data?.length) return null;
  return (
    <Card as="section" className="mb-8 border-accent/40 p-5">
      <h2 id="matches" className="scroll-mt-6 text-base font-semibold">Is this from one of your briefs?</h2>
      <p className="mt-1 text-sm text-ink-2">These posts were published outside the studio but look like a recent brief. Confirm so their results teach the engine.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {matches.data.map((m) => (
          <li key={m.id} className="grid gap-3 rounded-lg border border-line p-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-ink-3"><PlatformBadge platform={m.platform} withName={false} size="sm" />Posted {relativeTime(m.published_at)}</div>
              <p className="mt-1 line-clamp-2 text-sm">{m.caption}</p>
            </div>
            <div className="min-w-0 text-sm">
              <p className="flex items-center gap-1 text-xs text-ink-3"><ArrowRight className="size-3" aria-hidden />Looks like</p>
              <p className="mt-1 line-clamp-2 font-medium">{m.idea_title}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Check className="size-4" />} loading={decide.isPending && decide.variables?.id === m.id && decide.variables.accept}
                onClick={() => decide.mutate({ id: m.id, accept: true })}>Yes, link it</Button>
              <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => decide.mutate({ id: m.id, accept: false })}>No</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
