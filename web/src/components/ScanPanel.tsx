import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Globe, ListChecks, Loader2, Plus, ScanSearch, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ScanPage, ScanPreview } from "../lib/types";
import { useAppConfig, useWs } from "../lib/workspace";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { Badge, Button, ErrorNote, inputClass } from "./ui";

const TYPE_LABEL: Record<string, string> = {
  home: "Home", product: "Products", service: "Services", solution: "Solutions", pricing: "Pricing", case_study: "Case studies",
  faq: "FAQ", about: "About", industry: "Industries", contact: "Contact", blog: "Blog (newest)", other: "Other",
};

export const money = (usd: number) => (usd === 0 ? "$0" : usd < 0.01 ? "under $0.01" : `about $${usd.toFixed(2)}`);

/**
 * Scan every site the business owns: discover and fetch (free), show the page
 * count and estimated cost, and only then read with AI. Progress is polled; the
 * background part finishes even if the page is closed (checked again later).
 */
export function ScanPanel({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useAppConfig();
  const [scan, setScan] = useState<ScanPreview | null>(null);
  const [extra, setExtra] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const latest = useQuery({ queryKey: ["ws", ws, "scan-latest"], queryFn: () => api.latestScan(ws) });

  useEffect(() => {
    if (!scan && latest.data && (latest.data.status === "preview" || latest.data.status === "extracting")) setScan(latest.data);
  }, [latest.data, scan]);

  const preview = useMutation({
    mutationFn: () => api.previewScan(ws, extras),
    onSuccess: (s) => { setScan(s); setExtras([]); qc.invalidateQueries({ queryKey: ["ws", ws, "sources"] }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const start = useMutation({
    mutationFn: () => api.startScan(ws, scan!.scan_id),
    onSuccess: (s) => { setScan(s); qc.invalidateQueries({ queryKey: ["ws", ws, "cards"] }); qc.invalidateQueries({ queryKey: ["ws", ws, "products"] }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  // Poll while the background part runs; each poll also collects finished batch results.
  const running = scan?.status === "extracting";
  const poll = useQuery({
    queryKey: ["ws", ws, "scan", scan?.scan_id],
    queryFn: () => api.scan(ws, scan!.scan_id),
    enabled: !!scan && running,
    refetchInterval: running ? 8_000 : false,
  });
  useEffect(() => {
    if (!poll.data) return;
    setScan(poll.data);
    if (poll.data.status === "done") {
      qc.invalidateQueries({ queryKey: ["ws", ws] });
      toast({ tone: "success", message: `Scan finished: ${poll.data.cards_added} new facts to review.` });
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.data]);

  const confirm = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "rejected" }) => api.setSource(ws, id, status),
    onSuccess: (_d, v) => {
      if (v.status === "active") toast({ tone: "info", message: "Added. Scan again to include it." });
      setScan((s) => (s ? { ...s, pending_sources: s.pending_sources.filter((p) => p.id !== v.id) } : s));
    },
  });

  if (scan && scan.status === "preview") {
    const types = Object.entries(scan.pages_by_type).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-semibold">Found {scan.pages_found} pages on {scan.sources.length} {scan.sources.length === 1 ? "site" : "sites"}</h3>
          <p className="mt-1 text-sm text-ink-2">
            We'll read <span className="font-semibold text-ink">{scan.pages_to_read}</span> {scan.pages_to_read === 1 ? "page" : "pages"} that describe what you sell
            {scan.pages_reused > 0 && <> ({scan.pages_reused} unchanged since last time, free)</>}.
            Estimated AI cost: <span className="font-semibold text-ink">{money(scan.est_cost_usd)}</span>.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {scan.sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Globe className="size-4 text-ink-3" aria-hidden />
              <span className="font-medium">{s.domain}</span>
              <span className="text-ink-3">{s.pages} pages</span>
              {s.added_by === "auto" && <span className="inline-flex items-start gap-1 rounded-md bg-good-soft px-2 py-0.5 text-xs font-medium text-good"><Check className="mt-0.5 size-3 shrink-0" aria-hidden />Same brand: {s.reasons.slice(0, 2).join(", ")}</span>}
            </li>
          ))}
        </ul>
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {types.map(([t, n]) => <span key={t} className="rounded-md bg-surface-2 px-2 py-1 text-xs"><span className="font-semibold">{n}</span> {TYPE_LABEL[t] ?? t}</span>)}
          </div>
        )}
        {scan.pending_sources.length > 0 && (
          <div className="rounded-xl border border-line p-3">
            <p className="text-sm font-medium">Are these part of your business?</p>
            <p className="text-xs text-ink-3">We only scan other domains when you say so.</p>
            <ul className="mt-2 flex flex-col gap-2">
              {scan.pending_sources.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span><span className="font-medium">{p.domain}</span> <span className="text-ink-3">· {p.reasons.join(", ")}</span></span>
                  <span className="flex gap-2">
                    <Button size="sm" onClick={() => confirm.mutate({ id: p.id, status: "active" })}>Yes, it's ours</Button>
                    <Button size="sm" variant="ghost" onClick={() => confirm.mutate({ id: p.id, status: "rejected" })}>No</Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {scan.unreadable.length > 0 && (
          <details className="rounded-xl bg-test-soft px-3 py-2 text-sm text-test">
            <summary className="cursor-pointer font-medium"><AlertTriangle className="mr-1 inline size-4" aria-hidden />{scan.unreadable.length} pages couldn't be read</summary>
            <p className="mt-1">Upload a brochure or paste those pages' text in Knowledge → Files instead.</p>
            <ul className="mt-1 list-inside list-disc">{scan.unreadable.slice(0, 8).map((u) => <li key={u.url} className="break-all">{u.url.replace(/^https?:\/\//, "")}: {u.reason}</li>)}</ul>
          </details>
        )}
        {scan.est_cost_usd > 1 && <p className="text-sm text-test">This scan is larger than usual. Choose pages to keep the cost down, or continue.</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={start.isPending} disabled={!cfg.data?.ai_configured} icon={<ScanSearch className="size-4" />}
            onClick={() => (scan.est_cost_usd > 1 && !window.confirm(`This scan will cost ${money(scan.est_cost_usd)}. Continue?`) ? undefined : start.mutate())}>
            {scan.pages_to_read ? `Scan ${scan.pages_to_read} pages` : "Nothing new to read: finish"}
          </Button>
          <Button variant="ghost" icon={<ListChecks className="size-4" />} onClick={() => setChoosing(true)}>Choose pages</Button>
          <Button variant="ghost" onClick={() => setScan(null)}>Cancel</Button>
        </div>
        {start.isPending && <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" aria-hidden />Reading the first pages now; the rest continues in the background at half price.</p>}
        {choosing && <ChoosePages scan={scan} onClose={(s) => { setChoosing(false); if (s) setScan(s); }} />}
      </div>
    );
  }

  if (scan && scan.status === "extracting") {
    const pct = scan.pages_total ? Math.round((scan.pages_done / scan.pages_total) * 100) : 0;
    return (
      <div className="flex flex-col gap-3" aria-live="polite">
        <h3 className="flex items-center gap-2 text-base font-semibold"><Loader2 className="size-4 animate-spin text-accent" aria-hidden />Reading your pages…</h3>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="text-sm text-ink-2">{scan.pages_done} of {scan.pages_total} pages · {scan.cards_added} facts so far. The rest is read in the background at half price and usually finishes within minutes; you can leave this page.</p>
        {scan.error && <p className="text-sm text-bad">{scan.error}</p>}
      </div>
    );
  }

  const last = latest.data?.status === "done" ? latest.data : scan?.status === "done" ? scan : null;
  return (
    <div className="flex flex-col gap-4">
      {last && (last.error ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-test-soft px-3 py-2 text-sm text-test">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Last scan read {last.pages_done} of {last.pages_total} pages ({last.cards_added} new facts). {last.error}</span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          Last scan read {last.pages_total} {last.pages_total === 1 ? "page" : "pages"} and found {last.cards_added} new facts{last.actual_cost_usd != null ? ` for ${money(last.actual_cost_usd)}` : ""}.
        </p>
      ))}
      {!compact && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-2">Other sites you own (product sites, a shop, sister brands, a link-in-bio page)? Add them; related sites that clearly belong to you are found automatically.</p>
          <div className="flex gap-2">
            <input className={inputClass} placeholder="e.g. petrolord.com" value={extra} onChange={(e) => setExtra(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && extra.trim()) { e.preventDefault(); setExtras((x) => [...x, extra.trim()]); setExtra(""); } }} />
            <Button icon={<Plus className="size-4" />} disabled={!extra.trim()} onClick={() => { setExtras((x) => [...x, extra.trim()]); setExtra(""); }}>Add</Button>
          </div>
          {extras.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {extras.map((x) => (
                <li key={x} className="inline-flex items-center gap-1 rounded-md bg-surface-2 py-1 pl-2.5 pr-1 text-sm">{x}
                  <button type="button" className="rounded p-0.5 text-ink-3 hover:text-ink" aria-label={`Remove ${x}`} onClick={() => setExtras((xs) => xs.filter((y) => y !== x))}><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div>
        <Button variant={last ? "secondary" : "primary"} loading={preview.isPending} icon={<ScanSearch className="size-4" />} onClick={() => preview.mutate()}>
          {last ? "Scan again for changes" : "Find my pages"}
        </Button>
        <p className="mt-2 text-xs text-ink-3">Free until you confirm: we list the pages and the estimated cost first. Unchanged pages are never read twice.</p>
      </div>
      {preview.isPending && <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" aria-hidden />Reading your sitemap and menus, and checking linked sites… (up to a minute)</p>}
      {preview.isError && <ErrorNote error={preview.error} onRetry={() => preview.mutate()} />}
    </div>
  );
}

function ChoosePages({ scan, onClose }: { scan: ScanPreview; onClose: (s?: ScanPreview) => void }) {
  const ws = useWs();
  const pages = useQuery({ queryKey: ["ws", ws, "scan-pages", scan.scan_id], queryFn: () => api.scanPages(ws, scan.scan_id) });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  useEffect(() => { if (pages.data && !picked) setPicked(new Set(pages.data.filter((p) => p.selected).map((p) => p.id))); }, [pages.data, picked]);
  const save = useMutation({ mutationFn: () => api.selectScanPages(ws, scan.scan_id, [...(picked ?? [])]), onSuccess: (s) => onClose(s) });
  const toggle = (p: ScanPage) => setPicked((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; });
  return (
    <Dialog open onClose={() => onClose()} title="Choose pages to read" footer={
      <><Button variant="ghost" onClick={() => onClose()}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Use {picked?.size ?? 0} pages</Button></>
    }>
      {!pages.data ? <p className="text-sm text-ink-2">Loading…</p> : (
        <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {pages.data.map((p) => (
            <li key={p.id}>
              <label className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2 ${p.status === "unreadable" || p.status === "failed" ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-1" checked={picked?.has(p.id) ?? false} onChange={() => toggle(p)} disabled={p.status === "unreadable" || p.status === "failed"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.title || p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-ink-3">
                    <span>{TYPE_LABEL[p.page_type] ?? p.page_type}</span>
                    <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 break-all hover:text-ink">{p.url.replace(/^https?:\/\//, "")}<ExternalLink className="size-3" aria-hidden /></a>
                    {p.up_to_date && <span className="text-good">already read</span>}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
