import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, Send } from "lucide-react";
import { Link, useParams } from "react-router";
import { CopyButton, StatusPill } from "../components/bits";
import { BriefMeta, BriefView, briefToText } from "../components/BriefView";
import { useToast } from "../components/Toast";
import { Button, Card, ErrorNote, Skeleton } from "../components/ui";
import { api, download, exportUrl } from "../lib/api";
import { longDate } from "../lib/format";
import type { BriefStatus } from "../lib/types";
import { useWs } from "../lib/workspace";

const TIMELINE: { status: BriefStatus; label: string; help: string }[] = [
  { status: "draft", label: "Written", help: "Ready to send" },
  { status: "queued", label: "Sent to studio", help: "Waiting for the studio to pick it up" },
  { status: "delivered", label: "Delivered", help: "The studio has it" },
  { status: "acknowledged", label: "In production", help: "The studio is making it" },
];

export function BriefDetailPage() {
  const { id = "" } = useParams();
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const brief = useQuery({ queryKey: ["ws", ws, "brief", id], queryFn: () => api.brief(id) });
  const send = useMutation({
    mutationFn: () => api.queueBrief(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: "Sent to your studio." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  if (brief.isLoading) return <div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-96" /></div>;
  if (brief.isError) return <ErrorNote error={brief.error} onRetry={() => brief.refetch()} />;
  const { payload: b, status, title, created_at } = brief.data!;
  const reached = TIMELINE.findIndex((t) => t.status === (status === "failed" ? "queued" : status));
  const dl = (f: "md" | "json" | "csv") => download(exportUrl.brief(id, f), `${b.brief_id}.${f}`).catch((e) => toast({ tone: "error", message: e.message }));

  return (
    <>
      <Link to="/briefs" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Briefs</Link>
      <header className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2"><StatusPill status={status} /><span className="text-xs text-ink-3">Created {longDate(created_at)}</span></div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <BriefMeta b={b} />
        <div className="flex flex-wrap gap-2">
          {status === "draft" && <Button variant="primary" loading={send.isPending} onClick={() => send.mutate()} icon={<Send className="size-4" />}>Send to studio</Button>}
          <CopyButton text={briefToText(b)} label="Copy whole brief" className="h-10 rounded-lg border border-line-strong px-3 text-sm" />
          <Button variant="ghost" onClick={() => dl("md")} icon={<Download className="size-4" />}>Markdown</Button>
          <Button variant="ghost" onClick={() => dl("json")}>JSON</Button>
          <Button variant="ghost" onClick={() => dl("csv")}>CSV</Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <BriefView b={b} />
        <aside className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Progress</h2>
            <ol className="flex flex-col gap-3">
              {TIMELINE.map((t, i) => (
                <li key={t.status} className="flex gap-3">
                  <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${i <= reached ? "bg-good-soft text-good" : "bg-surface-2"}`}>
                    {i <= reached ? <Check className="size-3" aria-label="Done" /> : <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />}
                  </span>
                  <div>
                    <p className={`text-sm font-medium ${i <= reached ? "" : "text-ink-3"}`}>{t.label}</p>
                    {i === reached && <p className="text-xs text-ink-3">{status === "failed" ? "Delivery failed; it will retry" : t.help}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">How it's tracked</h2>
            <p className="text-ink-2">When this is published, the post carries this brief's id, so its results feed back into what you're shown next.</p>
            <p className="mt-2 break-all font-mono text-xs text-ink-3">{b.brief_id}</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
