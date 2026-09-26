import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LabelBadge, PlatformBadge, Segmented, StatusPill } from "../components/bits";
import { Button, EmptyState, ErrorNote, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { BriefListItem } from "../lib/types";
import { useWs } from "../lib/workspace";

type Tab = "active" | "done" | "draft";
const TAB_STATUS: Record<Tab, BriefListItem["status"][]> = {
  active: ["queued", "failed", "delivered"],
  done: ["acknowledged"],
  draft: ["draft"],
};

export function Briefs() {
  const ws = useWs();
  const nav = useNavigate();
  const briefs = useQuery({ queryKey: ["ws", ws, "briefs"], queryFn: () => api.briefs(ws) });
  const [chosen, setTab] = useState<Tab | null>(null);
  const all = briefs.data ?? [];
  const count = (t: Tab) => all.filter((b) => TAB_STATUS[t].includes(b.status)).length;
  // Open on the first tab that has something in it.
  const tab: Tab = chosen ?? ((["active", "done", "draft"] as Tab[]).find((t) => count(t) > 0) ?? "active");
  const shown = all.filter((b) => TAB_STATUS[tab].includes(b.status));

  return (
    <>
      <PageHeader title="Briefs" subtitle="Everything you've sent to your studio, and where it's at." />
      {briefs.isLoading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        : briefs.isError ? <ErrorNote error={briefs.error} onRetry={() => briefs.refetch()} />
        : all.length === 0 ? (
          <EmptyState icon={<FileText className="size-8" />} title="No briefs yet" action={<Button variant="primary" onClick={() => nav("/week")}>Pick an idea</Button>}>
            Choose an idea on This week and press "Create brief". It lands here and in your studio.
          </EmptyState>
        ) : (
          <>
            <div className="mb-4">
              <Segmented label="Brief status" value={tab} onChange={setTab} options={[
                { value: "active", label: <>With the studio <span className="text-ink-3">{count("active")}</span></> },
                { value: "done", label: <>In production <span className="text-ink-3">{count("done")}</span></> },
                { value: "draft", label: <>Drafts <span className="text-ink-3">{count("draft")}</span></> },
              ]} />
              {tab === "draft" && <p className="mt-2 text-xs text-ink-3">Drafts are ready but not sent: Autopilot's picks for this week and versions from Refine.</p>}
            </div>
            {shown.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-2">Nothing here right now.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {shown.map((b) => (
                  <li key={b.id}>
                    <Link to={`/briefs/${b.id}`} className="flex items-center gap-4 px-4 py-3.5 hover:bg-surface-2">
                      <PlatformBadge platform={b.platform} withName={false} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{b.title}</p>
                        <p className="truncate text-xs text-ink-3">{b.first_hook ? `"${b.first_hook}"` : b.kind === "general" ? "General brief" : ""}</p>
                      </div>
                      <div className="hidden sm:block"><LabelBadge label={b.label} /></div>
                      <StatusPill status={b.status} />
                      <span className="hidden w-24 text-right text-xs text-ink-3 md:block">{relativeTime(b.created_at)}</span>
                      <ChevronRight className="size-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
    </>
  );
}
