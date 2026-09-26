import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, FileText, Lightbulb } from "lucide-react";
import { Link, useParams } from "react-router";
import { LabelBadge, PiBadge, PlatformBadge } from "../components/bits";
import { TrendChart } from "../components/charts";
import { Card, ErrorNote, SectionTitle, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { FEATURE_NAMES, featureValue, longDate, num, pct } from "../lib/format";
import type { Snapshot } from "../lib/types";
import { useWs } from "../lib/workspace";

const OFFSET_NAME: Record<string, string> = { "1h": "1 hour", "6h": "6 hours", "24h": "1 day", "72h": "3 days", "7d": "7 days", "28d": "28 days", backfill: "Lifetime" };
const METRICS: { key: keyof Snapshot; label: string; fmt?: (n: number) => string }[] = [
  { key: "views", label: "Views" }, { key: "reach", label: "Reach" }, { key: "likes", label: "Likes" }, { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" }, { key: "saves", label: "Saves" }, { key: "sends", label: "Sends" },
  { key: "avg_watch_seconds", label: "Avg. watch", fmt: (n) => `${n.toFixed(1)}s` }, { key: "completion_rate", label: "Watched to end", fmt: (n) => pct(n) },
  { key: "link_clicks", label: "Link clicks" }, { key: "profile_visits", label: "Profile visits" }, { key: "followers_gained", label: "New followers" },
];

export function PostDetailPage() {
  const { id = "" } = useParams();
  const ws = useWs();
  const post = useQuery({ queryKey: ["ws", ws, "post", id], queryFn: () => api.post(id) });
  if (post.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-64" /></div>;
  if (post.isError) return <ErrorNote error={post.error} onRetry={() => post.refetch()} />;
  const d = post.data!;
  const latest = d.metric_curve.at(-1);
  const curve = d.metric_curve.filter((s) => s.offset_label !== "backfill").map((s) => ({ ...s, when: s.offset_label }));
  const features = Object.entries(d.features).filter(([k]) => k !== "language");
  const verdictText = { beat_baseline: "Beat your usual", near_baseline: "About your usual", below_baseline: "Below your usual" };

  return (
    <>
      <Link to="/analytics" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Analytics</Link>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <PlatformBadge platform={d.platform} />
          <span>{longDate(d.published_at)}</span>
          <LabelBadge label={d.label} />
          {d.permalink && <a href={d.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">View post <ExternalLink className="size-3.5" aria-hidden /></a>}
        </div>
        <h1 className="mt-3 text-xl font-semibold leading-snug sm:text-2xl">{d.caption ?? "Untitled post"}</h1>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-sm text-ink-2">Views at 3 days</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{num(d.views_72h)}</p>
          <p className="mt-1 text-xs text-ink-3">Your usual: {num(d.baseline_views)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-2">Against your usual</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{d.pi == null ? "—" : `${d.pi.toFixed(1)}×`}</p>
          <div className="mt-1"><PiBadge pi={d.pi} /></div>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-ink-2">Goal result</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{d.goal_index == null ? "—" : `${d.goal_index.toFixed(1)}×`}</p>
          <p className="mt-1 text-xs text-ink-3">A post can win on business value even with modest views.</p>
        </Card>
      </div>

      {d.autopsy && (
        <Card as="section" className="mb-6 p-5">
          <SectionTitle>What happened · {verdictText[d.autopsy.body.verdict]}</SectionTitle>
          <p className="text-sm leading-relaxed">{d.autopsy.body.summary}</p>
          <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="font-medium">Takeaway: </span>{d.autopsy.body.takeaway}</p>
        </Card>
      )}

      <Card as="section" className="mb-6 p-5">
        <SectionTitle>How views grew</SectionTitle>
        {curve.length < 2 ? <p className="py-6 text-center text-sm text-ink-2">Views are measured at 1 hour, 6 hours, 1 day, 3 days, 7 days and 28 days after posting.</p> : (
          <TrendChart title="Views after posting" data={curve} x="when" xFormat={(v) => OFFSET_NAME[v] ?? v} height={200}
            series={[{ key: "views", name: "Views", color: "--c-series-1" }]} />
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card as="section" className="p-5">
          <SectionTitle>{latest ? `All numbers · at ${OFFSET_NAME[latest.offset_label] ?? latest.offset_label}` : "All numbers"}</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {METRICS.map((m) => {
              const v = latest?.[m.key] as number | null | undefined;
              return (
                <div key={m.key}>
                  <dt className="text-xs text-ink-3">{m.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums" title={v == null ? "This platform doesn't provide this number" : undefined}>
                    {v == null ? <span className="text-ink-3">—</span> : m.fmt ? m.fmt(Number(v)) : num(Number(v))}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="mt-4 text-xs text-ink-3">"—" means the platform doesn't share that number. We never estimate it.</p>
        </Card>
        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <SectionTitle>Where it came from</SectionTitle>
            {d.idea_id ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="flex items-start gap-2"><Lightbulb className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />{d.idea_title}</p>
                {d.brief_id && <Link to={`/briefs/${d.brief_id}`} className="flex items-center gap-2 text-accent hover:underline"><FileText className="size-4" aria-hidden />Open the brief</Link>}
              </div>
            ) : <p className="text-sm text-ink-2">Published outside the studio, so there's no linked brief.</p>}
          </Card>
          {features.length > 0 && (
            <Card className="p-4">
              <SectionTitle>What we learn from</SectionTitle>
              <dl className="flex flex-col gap-1.5 text-sm">
                {features.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{FEATURE_NAMES[k] ?? k}</dt><dd className="text-right font-medium">{featureValue(k, v)}</dd></div>
                ))}
              </dl>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
