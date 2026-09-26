import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardList, HelpCircle, Lightbulb, MessageCircleReply, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PiBadge } from "../components/bits";
import { Badge, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { FEATURE_NAMES, featureValue, PLATFORM_META, shortDate } from "../lib/format";
import type { Claim, Platform, ReportDetail } from "../lib/types";
import { useWs } from "../lib/workspace";

export function ReportsPage() {
  const ws = useWs();
  const { id } = useParams();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["ws", ws, "reports"], queryFn: () => api.reports(ws) });
  const current = id ?? list.data?.[0]?.id;
  const report = useQuery({ queryKey: ["ws", ws, "report", current], queryFn: () => api.report(current!), enabled: !!current });

  if (list.isLoading) return <><PageHeader title="Reports" /><Skeleton className="h-96" /></>;
  if (list.isError) return <><PageHeader title="Reports" /><ErrorNote error={list.error} onRetry={() => list.refetch()} /></>;
  if (!list.data?.length) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState icon={<ClipboardList className="size-8" />} title="Your first report is on its way">
          Every Sunday you get a plain-language report: what worked, what didn't, why, and what to do next. The first one arrives after 3 posts have 72-hour results.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Weekly: what worked, what didn't, why, and what we'll do next." actions={list.data.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <span>Week</span>
          <select className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm" value={current} onChange={(e) => nav(`/reports/${e.target.value}`)}>
            {list.data.map((r) => <option key={r.id} value={r.id}>{shortDate(r.period_start)} – {shortDate(r.period_end)}</option>)}
          </select>
        </label>
      )} />
      {report.isLoading ? <Skeleton className="h-96" /> : report.isError ? <ErrorNote error={report.error} onRetry={() => report.refetch()} /> : report.data && <Report r={report.data} />}
    </>
  );
}

function Cited({ ids, r }: { ids: string[]; r: ReportDetail }) {
  const posts = r.input_table.posts ?? [];
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Posts behind this">
      {ids.map((id) => {
        const p = posts.find((x) => x.post_id === id);
        return (
          <li key={id}>
            <Link to={`/analytics/posts/${id}`} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-2">
              {p ? <>{PLATFORM_META[p.platform as Platform]?.short ?? p.platform} · {shortDate(p.published_at)}</> : "Post"}
              {p?.pi != null && <PiBadge pi={p.pi} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Block({ icon, title, items, r, empty }: { icon: ReactNode; title: string; items: Claim[]; r: ReportDetail; empty: string }) {
  return (
    <Card as="section" className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
      {items.length === 0 ? <p className="text-sm text-ink-3">{empty}</p> : (
        <ul className="flex flex-col gap-4">
          {items.map((c, i) => <li key={i}><p className="text-sm leading-relaxed">{c.text}</p><Cited ids={c.post_ids} r={r} /></li>)}
        </ul>
      )}
    </Card>
  );
}

function Report({ r }: { r: ReportDetail }) {
  const b = r.body;
  return (
    <article className="flex flex-col gap-5">
      <Card className="p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Week of {shortDate(r.period_start)} – {shortDate(r.period_end)}</p>
        <h2 className="mt-2 text-xl font-semibold leading-snug sm:text-2xl">{b.headline}</h2>
        <p className="mt-2 text-sm text-ink-3">Every number was calculated from your posts; every claim links to the posts behind it.</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Block icon={<CheckCircle2 className="size-5 text-good" aria-hidden />} title="What worked" items={b.what_worked} r={r} empty="No clear winner this week." />
        <Block icon={<XCircle className="size-5 text-bad" aria-hidden />} title="What didn't" items={b.what_didnt} r={r} empty="Nothing clearly underperformed." />
      </div>
      <Block icon={<HelpCircle className="size-5 text-ink-3" aria-hidden />} title="Why we think so" items={b.why} r={r} empty="Not enough posts to say why yet." />

      <Card as="section" className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Lightbulb className="size-5 text-accent" aria-hidden />What's next</h2>
        <p className="mb-4 text-sm text-ink-2">These are already applied to your next ideas. You don't need to do anything.</p>
        {b.what_next.length === 0 ? <p className="text-sm text-ink-3">No changes this week: keep going.</p> : (
          <ul className="flex flex-col gap-3">
            {b.what_next.map((n, i) => (
              <li key={i} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={n.action === "prefer" ? "good" : n.action === "avoid" ? "bad" : "test"}>
                    {n.action === "prefer" ? "Do more" : n.action === "avoid" ? "Do less" : "Try"}
                  </Badge>
                  <span className="text-sm font-medium">{FEATURE_NAMES[n.feature] ?? n.feature}: {featureValue(n.feature, n.value)}</span>
                  {n.platform !== "all" && <span className="text-xs text-ink-3">on {PLATFORM_META[n.platform as Platform]?.name ?? n.platform}</span>}
                </div>
                <p className="mt-2 text-sm text-ink-2">{n.rationale}</p>
                <Cited ids={n.post_ids} r={r} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {b.nudges.length > 0 && (
        <Card as="section" className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><MessageCircleReply className="size-5 text-ink-3" aria-hidden />Small things that help</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink-2">{b.nudges.map((n) => <li key={n} className="flex gap-2"><ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />{n}</li>)}</ul>
        </Card>
      )}
    </article>
  );
}
