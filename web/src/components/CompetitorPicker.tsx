import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import type { CompetitorSuggestion, Platform } from "../lib/types";
import { useAppConfig } from "../lib/workspace";
import { PlatformBadge } from "./bits";
import { NarratedProgress } from "./Progress";
import { useToast } from "./Toast";
import { Badge, Button, ErrorNote, Skeleton } from "./ui";

const CONF_TEXT = { high: "Strong match", medium: "Likely match", low: "Possible match" } as const;
const PLATFORMS: Platform[] = ["instagram", "youtube", "tiktok", "linkedin", "facebook"];

/**
 * Researched competitor suggestions: tick up to the limit, or let the AI pick
 * the strongest. Already-tracked competitors show as added.
 */
export function CompetitorPicker({ ws, onChanged }: { ws: string; onChanged?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useAppConfig();
  const q = useQuery({ queryKey: ["ws", ws, "competitor-suggestions"], queryFn: () => api.competitorSuggestions(ws) });
  const [picked, setPicked] = useState<string[]>([]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); onChanged?.(); };

  const select = useMutation({
    mutationFn: (pick: { names?: string[]; auto?: boolean }) => api.selectCompetitors(ws, pick),
    onSuccess: (r) => {
      setPicked([]);
      refresh();
      toast({
        tone: "success",
        message: r.added.length
          ? `Tracking ${r.added.join(", ")}.${r.skipped.length ? ` ${r.skipped.length} more didn't fit the limit of ${r.limit}.` : ""}`
          : `You're already tracking the maximum of ${r.limit}.`,
      });
    },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const research = useMutation({
    mutationFn: () => api.refreshCompetitorSuggestions(ws),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws, "competitor-suggestions"] }),
  });

  if (q.isLoading) return <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const { suggestions, tracked, limit } = q.data!;
  const slots = Math.max(0, limit - tracked);
  const open = suggestions.filter((s) => !s.tracked);
  const toggle = (n: string) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : p.length < slots ? [...p, n] : p));

  if (research.isPending) {
    return (
      <div className="rounded-xl border border-line p-4">
        <p className="text-sm font-medium">Researching competitors…</p>
        <p className="mb-3 text-xs text-ink-2">This searches the web and can take 2 to 3 minutes. You can keep this page open.</p>
        <NarratedProgress intervalMs={8000} steps={["Reading what you sell", "Searching your market", "Checking who sells the same things", "Finding their social profiles"]} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {suggestions.length === 0
            ? cfg.data?.ai_configured ? "No suggestions yet. Let us search your market, or add competitors yourself." : "Add the competitors you know below."
            : slots === 0
              ? `You're tracking ${tracked} of ${limit}. Remove one to add another.`
              : <>Pick up to <span className="font-semibold text-ink">{slots}</span> more · <span className="font-semibold text-ink">{picked.length}</span> selected</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {cfg.data?.ai_configured && (
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => research.mutate()}>
              {suggestions.length ? "Find again" : "Find competitors"}
            </Button>
          )}
          {open.length > 0 && slots > 0 && (
            <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />} loading={select.isPending && select.variables?.auto}
              onClick={() => select.mutate({ auto: true })}>
              Let AI pick the best {Math.min(slots, open.length)}
            </Button>
          )}
        </div>
      </div>

      {suggestions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {suggestions.map((s) => <Row key={s.name} s={s} checked={picked.includes(s.name)} disabled={!s.tracked && !picked.includes(s.name) && picked.length >= slots} onToggle={() => toggle(s.name)} />)}
        </ul>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-20 z-10 flex items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-ink shadow-lg lg:bottom-4">
          <span className="text-sm">{picked.length} selected</span>
          <Button variant="accent" loading={select.isPending && !select.variables?.auto} onClick={() => select.mutate({ names: picked })}>
            Track {picked.length === 1 ? "this competitor" : `these ${picked.length}`}
          </Button>
        </div>
      )}
      {research.isError && <ErrorNote error={research.error} onRetry={() => research.mutate()} />}
    </div>
  );
}

function Row({ s, checked, disabled, onToggle }: { s: CompetitorSuggestion; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const handles = PLATFORMS.filter((p) => s.handles[p]);
  return (
    <li>
      <label className={`flex gap-3 rounded-xl border p-3 ${s.tracked ? "border-good/40 bg-good-soft/40" : checked ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"} ${disabled ? "opacity-60" : "cursor-pointer"}`}>
        <span className="pt-0.5">
          {s.tracked ? (
            <span className="grid size-5 place-items-center rounded bg-good text-white" aria-label="Already tracked"><Check className="size-3.5" /></span>
          ) : (
            <input type="checkbox" className="size-5 accent-[var(--c-accent)]" checked={checked} disabled={disabled} onChange={onToggle} aria-label={`Track ${s.name}`} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{s.name}</span>
            <Badge tone={s.confidence === "high" ? "good" : s.confidence === "medium" ? "neutral" : "test"}>{CONF_TEXT[s.confidence]}</Badge>
            {s.tracked && <Badge tone="good">Tracking</Badge>}
            {s.market && <span className="text-xs text-ink-3">{s.market}</span>}
          </span>
          {s.why && <span className="mt-1 block text-sm text-ink-2">{s.why}</span>}
          {s.overlap.length > 0 && <span className="mt-1 block text-xs text-ink-3">Competes with your: {s.overlap.join(", ")}</span>}
          <span className="mt-2 flex flex-wrap items-center gap-3">
            {s.website && (
              <a href={s.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
                {s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}<ExternalLink className="size-3" aria-hidden />
              </a>
            )}
            {handles.map((p) => <PlatformBadge key={p} platform={p} withName={false} size="sm" />)}
            {handles.length === 0 && <span className="text-xs text-ink-3">No social profiles found; you can add handles later</span>}
          </span>
        </span>
      </label>
    </li>
  );
}
