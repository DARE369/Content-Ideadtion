import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Download, Lightbulb, Link2, RefreshCw, Rocket } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { AutopilotDialog, autopilotPlan } from "../components/AutopilotDialog";
import { PlatformBadge, Segmented } from "../components/bits";
import { CreateBriefDialog } from "../components/CreateBriefDialog";
import { IdeaCardView } from "../components/IdeaCard";
import { NarratedProgress } from "../components/Progress";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from "../components/ui";
import { api, download, exportUrl } from "../lib/api";
import { featureValue, IDEA_STEPS, PLATFORM_META, relativeTime, STAGE_TEXT, weekRange } from "../lib/format";
import type { IdeaCard, Platform } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";

export function ThisWeek() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const summary = useSummary();
  const cfg = useAppConfig();
  const ideas = useQuery({ queryKey: ["ws", ws, "ideas"], queryFn: () => api.ideas(ws) });
  const [filter, setFilter] = useState<"all" | Platform>("all");
  const [kind, setKind] = useState<"all" | "proven" | "test">("all");
  const [briefFor, setBriefFor] = useState<IdeaCard | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  const pendingDismiss = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const generate = useMutation({
    mutationFn: () => api.generateIdeas(ws),
    onSuccess: (r) => {
      qc.setQueryData(["ws", ws, "ideas"], r.ideas);
      qc.invalidateQueries({ queryKey: ["ws", ws, "summary"] });
      toast({ tone: "success", message: `${r.ideas.length} ideas made the cut${r.drafted ? ` from ${r.drafted} drafts` : ""}.${r.scan.warning ? ` ${r.scan.warning}` : ""}` });
    },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  // Dismiss is instant in the UI and only committed after the undo window.
  const dismiss = (idea: IdeaCard) => {
    qc.setQueryData<IdeaCard[]>(["ws", ws, "ideas"], (xs) => xs?.filter((x) => x.idea_id !== idea.idea_id));
    const t = setTimeout(() => {
      pendingDismiss.current.delete(idea.idea_id);
      api.dismissIdea(idea.idea_id).catch(() => toast({ tone: "error", message: "Couldn't remove that idea. It may come back on refresh." }));
    }, 6500);
    pendingDismiss.current.set(idea.idea_id, t);
    toast({
      tone: "info", message: "Idea removed. We'll suggest fewer like it.",
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(pendingDismiss.current.get(idea.idea_id));
          pendingDismiss.current.delete(idea.idea_id);
          qc.setQueryData<IdeaCard[]>(["ws", ws, "ideas"], (xs) => [...(xs ?? []), idea].sort((a, b) => b.score - a.score));
        },
      },
    });
  };

  const list = ideas.data ?? [];
  const platformsInList = [...new Set(list.map((i) => i.platform).filter((p): p is Platform => !!p))];
  const shown = list.filter((i) => (filter === "all" || i.platform === filter) && (kind === "all" || i.label === kind));
  const connected = summary.data?.platforms ?? [];
  const plan = autopilotPlan(list, connected);
  const proven = list.filter((i) => i.label === "proven").length;

  return (
    <>
      <PageHeader
        title="This week"
        subtitle={<>{weekRange()} · {list.length ? `${list.length} ideas, refreshed ${relativeTime(summary.data?.ideas_refreshed_at)}` : "No ideas yet"}</>}
        actions={list.length > 0 && (
          <>
            <Button variant="ghost" size="sm" icon={<Download className="size-4" />}
              onClick={() => download(exportUrl.ideas(ws, "md"), "ideas.md").catch((e) => toast({ tone: "error", message: e.message }))}>Export</Button>
            {cfg.data?.ai_configured && (
              <Button variant="secondary" size="sm" loading={generate.isPending} onClick={() => generate.mutate()} icon={<RefreshCw className="size-4" />}>New ideas</Button>
            )}
          </>
        )}
      />

      <SetupChecklist />

      {!!summary.data?.pending_matches && (
        <Link to="/analytics#matches" className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm hover:bg-surface-2">
          <Link2 className="size-4 text-accent" aria-hidden />
          <span className="flex-1"><span className="font-medium">{summary.data.pending_matches} post{summary.data.pending_matches > 1 ? "s" : ""} published outside the studio</span> may match a brief. Confirm so they count toward learning.</span>
          <ArrowRight className="size-4 text-ink-3" aria-hidden />
        </Link>
      )}

      {/* Autopilot: the one-tap path */}
      {list.length > 0 && connected.length > 0 && (
        <Card className="mb-8 overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Rocket className="size-5" aria-hidden /></div>
            <div className="flex-1">
              <h2 className="text-base font-semibold">Short on time? Make this week's posts in one tap.</h2>
              <p className="mt-0.5 text-sm text-ink-2">
                Sends the strongest idea for {plan.length === 1 ? "your platform" : `each of your ${plan.length} platforms`} to your studio as a ready-to-shoot brief.
              </p>
              <div className="mt-2 flex flex-wrap gap-3">{plan.map((p) => <PlatformBadge key={p.platform} platform={p.platform} withName={false} size="sm" />)}</div>
            </div>
            <Button variant="accent" size="lg" onClick={() => setAutopilot(true)} disabled={plan.length === 0}>Make this week's posts</Button>
          </div>
        </Card>
      )}

      {ideas.isLoading ? (
        <div className="flex flex-col gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : ideas.isError ? (
        <ErrorNote error={ideas.error} onRetry={() => ideas.refetch()} />
      ) : generate.isPending && list.length === 0 ? (
        <Card className="p-6">
          <h2 className="font-semibold">Writing this week's ideas…</h2>
          <div className="mt-4"><NarratedProgress intervalMs={14000} steps={IDEA_STEPS} /></div>
        </Card>
      ) : list.length === 0 ? (
        <EmptyState icon={<Lightbulb className="size-8" />} title="No ideas yet this week"
          action={cfg.data?.ai_configured
            ? <Button variant="primary" loading={generate.isPending} onClick={() => generate.mutate()}>Generate ideas</Button>
            : undefined}>
          {cfg.data?.ai_configured
            ? "Ideas arrive automatically every night. You can also generate a batch now; it takes a minute or two."
            : "Idea generation needs an Anthropic API key on the server. Once it's set, ideas arrive every night."}
        </EmptyState>
      ) : (
        <section aria-labelledby="ideas-heading">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="ideas-heading" className="text-base font-semibold">
              Ideas <span className="font-normal text-ink-3">· {proven} proven, {list.length - proven} to test</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {platformsInList.length > 1 && (
                <Segmented label="Platform" value={filter} onChange={setFilter}
                  options={[{ value: "all", label: "All" }, ...platformsInList.map((p) => ({ value: p, label: PLATFORM_META[p].name }))]} />
              )}
              <Segmented label="Type" value={kind} onChange={setKind}
                options={[{ value: "all", label: "All" }, { value: "proven", label: "Proven" }, { value: "test", label: "Tests" }]} />
            </div>
          </div>
          <IdeaMix ideas={list} />
          {list.every((i) => i.confidence === "low") && <LowConfidenceNote />}
          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-2">No ideas match these filters.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {shown.map((idea) => <IdeaCardView key={idea.idea_id} idea={idea} onBrief={() => setBriefFor(idea)} onDismiss={() => dismiss(idea)} />)}
            </div>
          )}
          <p className="mt-6 text-center text-xs text-ink-3">
            Proven = reuses a pattern that beat your usual results. Test = something new, so you keep finding what works next. Rankings are relative to your own posts; nobody can promise a view count.
          </p>
        </section>
      )}

      <CreateBriefDialog idea={briefFor} onClose={() => setBriefFor(null)} />
      <AutopilotDialog open={autopilot} onClose={() => setAutopilot(false)} ideas={list} platforms={connected} />
    </>
  );
}

/** Where this week's ideas sit in the buyer journey and what they sell. */
function IdeaMix({ ideas }: { ideas: IdeaCard[] }) {
  const stages = (["awareness", "consideration", "decision"] as const).map((s) => [s, ideas.filter((i) => i.features.funnel_stage === s).length] as const);
  const offers = new Map<string, number>();
  for (const i of ideas) if (i.features.offer) offers.set(i.features.offer, (offers.get(i.features.offer) ?? 0) + 1);
  if (!stages.some(([, n]) => n) && offers.size === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      {stages.some(([, n]) => n) && (
        <p><span className="text-ink-3">Buyer stage: </span>{stages.map(([s, n]) => `${n} ${STAGE_TEXT[s]!.label.toLowerCase()}`).join(" · ")}</p>
      )}
      {offers.size > 0 && (
        <p><span className="text-ink-3">Sells: </span>{[...offers].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${featureValue("offer", o)} (${n})`).join(" · ")}</p>
      )}
    </div>
  );
}

function LowConfidenceNote() {
  return (
    <details className="mb-4 rounded-xl border border-line px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Why every idea says "low confidence"</summary>
      <div className="mt-2 flex flex-col gap-2 text-ink-2">
        <p>Confidence is how much real evidence backs an idea, not how good it is. Right now these rest mostly on your Brand Brain. It goes up when:</p>
        <ul className="list-inside list-disc">
          <li><span className="text-ink">Current news or buyer questions support the idea.</span> Each batch starts with a web scan of your market; ideas that cite two sources reach medium.</li>
          <li><span className="text-ink">A competitor's similar post beat their usual.</span> <Link className="underline" to="/settings/competitors">Track competitors</Link> with Instagram, YouTube or TikTok accounts.</li>
          <li><span className="text-ink">Your own posts show results.</span> After 5 posts with results on a platform, ideas can reach high. <Link className="underline" to="/settings/accounts">Connect accounts</Link> in your studio.</li>
        </ul>
      </div>
    </details>
  );
}

function SetupChecklist() {
  const summary = useSummary();
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem("ideation.checklist.hidden") === "1"; } catch { return false; }
  });
  const s = summary.data;
  if (!s || hidden) return null;
  const items = [
    { done: !!s.confirmed_at, label: "Confirm your Brand Brain", to: "/settings/brand" },
    { done: s.competitors > 0, label: "Add competitors to learn from", to: "/settings/competitors" },
    { done: s.platforms.length > 0, label: "Connect accounts in your studio", to: "/settings/accounts" },
    { done: s.briefs > 0, label: "Send your first brief", to: null },
  ];
  const left = items.filter((i) => !i.done).length;
  if (left === 0) return null;
  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Getting set up</h2>
          <p className="text-xs text-ink-3">{items.length - left} of {items.length} done. Each step makes the ideas sharper.</p>
        </div>
        <button className="text-xs text-ink-3 hover:text-ink" onClick={() => { setHidden(true); try { localStorage.setItem("ideation.checklist.hidden", "1"); } catch { /* ignore */ } }}>Hide</button>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label}>
            {i.to && !i.done ? (
              <Link to={i.to} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="size-4 rounded-full border border-line-strong" aria-hidden />{i.label}<ArrowRight className="ml-auto size-3.5 text-ink-3" aria-hidden />
              </Link>
            ) : (
              <span className={`flex items-center gap-2 px-2 py-1.5 text-sm ${i.done ? "text-ink-3 line-through" : ""}`}>
                {i.done ? <Check className="size-4 text-good" aria-label="Done" /> : <span className="size-4 rounded-full border border-line-strong" aria-hidden />}
                {i.label}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
