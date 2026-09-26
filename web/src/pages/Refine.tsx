import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, Loader2, Send, Sparkles, ThumbsUp, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { PlatformBadge } from "../components/bits";
import { BriefView } from "../components/BriefView";
import { CreateBriefDialog } from "../components/CreateBriefDialog";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, ErrorNote, PageHeader, SectionTitle, textareaClass } from "../components/ui";
import { api } from "../lib/api";
import { ALL_PLATFORMS, PLATFORM_META, RELATIVE_TEXT } from "../lib/format";
import { refineStream, type RefinedIdea } from "../lib/refineStream";
import type { BriefPayload, Platform, Relative } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";

const EXAMPLES = [
  "A video showing how much a wedding cake really costs to make",
  "Answer the question people keep asking about delivery",
  "Behind the scenes of a busy Saturday",
];

type Phase = "idle" | "verdict" | "ideas" | "briefs" | "done";

export function Refine() {
  const ws = useWs();
  const cfg = useAppConfig();
  const summary = useSummary();
  const connected = summary.data?.platforms ?? [];
  const [text, setText] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdict, setVerdict] = useState("");
  const [ideas, setIdeas] = useState<{ sharpened: RefinedIdea; alternatives: RefinedIdea[] } | null>(null);
  const [versions, setVersions] = useState<{ platform: Platform | "general"; brief: BriefPayload }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fatal, setFatal] = useState<Error | null>(null);
  const [active, setActive] = useState(0);
  const [briefFor, setBriefFor] = useState<RefinedIdea | null>(null);
  const abort = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (connected.length && platforms.length === 0) setPlatforms(connected); }, [connected.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);

  const expected = platforms.length || 1;
  const run = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase("verdict"); setVerdict(""); setIdeas(null); setVersions([]); setErrors([]); setFatal(null); setActive(0);
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    try {
      await refineStream(ws, text.trim(), platforms, (e) => {
        if (e.type === "verdict_delta") setVerdict((v) => v + e.text);
        else if (e.type === "verdict_done") { setVerdict(e.text); setPhase("ideas"); }
        else if (e.type === "ideas") { setIdeas({ sharpened: e.sharpened, alternatives: e.alternatives }); setPhase("briefs"); }
        else if (e.type === "platform_brief") setVersions((v) => [...v, { platform: e.platform, brief: e.brief }]);
        else if (e.type === "error") setErrors((x) => [...x, e.message]);
        else if (e.type === "done") setPhase("done");
      }, ctl.signal);
      setPhase("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setFatal(err as Error);
      setPhase("done");
    }
  };

  const disabled = cfg.data && !cfg.data.ai_configured;
  const tone = verdict.startsWith("Strong") ? "good" : verdict.startsWith("Weak") ? "bad" : "test";

  return (
    <>
      <PageHeader title="Refine my idea" subtitle="Got an idea of your own? Get an honest verdict, a sharper version and ready-to-shoot versions for each platform." />

      <Card className="p-5">
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 3) run(); }}>
          <label htmlFor="raw-idea" className="text-sm font-medium">Your idea</label>
          <textarea
            id="raw-idea"
            rows={3}
            className={`${textareaClass} mt-2 text-base`}
            placeholder="One sentence is enough, e.g. a video about why our cakes cost what they cost"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim().length >= 3) run(); }}
          />
          {!text && (
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs text-ink-3">Try:</span>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 hover:bg-surface-2">{ex}</button>
              ))}
            </div>
          )}
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Make versions for</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(connected.length ? connected : ALL_PLATFORMS).map((p) => {
                const on = platforms.includes(p);
                return (
                  <button key={p} type="button" role="checkbox" aria-checked={on}
                    onClick={() => setPlatforms((x) => (on ? x.filter((y) => y !== p) : [...x, p]))}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2"}`}>
                    {on && <Check className="size-3.5 text-accent" aria-hidden />}{PLATFORM_META[p].name}
                  </button>
                );
              })}
            </div>
            {platforms.length === 0 && <p className="mt-2 text-xs text-ink-3">No platform selected: you'll get one general brief instead.</p>}
          </fieldset>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="lg" icon={<Wand2 className="size-4" />}
              disabled={!!disabled || text.trim().length < 3} loading={phase !== "idle" && phase !== "done"}>
              {phase !== "idle" && phase !== "done" ? "Refining…" : "Refine"}
            </Button>
            <span className="hidden text-xs text-ink-3 sm:inline">⌘/Ctrl + Enter</span>
            {disabled && <span className="text-sm text-bad">Refine needs an Anthropic API key on the server.</span>}
          </div>
        </form>
      </Card>

      <div ref={resultsRef} className="scroll-mt-6">
        {phase !== "idle" && (
          <ol className="my-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Progress">
            {[
              { key: "verdict", label: "Verdict" },
              { key: "ideas", label: "Sharper versions" },
              { key: "briefs", label: `Platform versions ${versions.length}/${expected}` },
            ].map((s, i) => {
              const order = ["verdict", "ideas", "briefs", "done"].indexOf(phase);
              const state = order > i || phase === "done" ? "done" : order === i ? "active" : "todo";
              return (
                <li key={s.key} className={`flex items-center gap-2 ${state === "todo" ? "text-ink-3" : ""}`}>
                  {state === "done" ? <CircleCheck className="size-4 text-good" aria-label="Done" /> : state === "active" ? <Loader2 className="size-4 animate-spin text-accent" aria-label="In progress" /> : <span className="size-4 rounded-full border border-line-strong" aria-hidden />}
                  {s.label}
                </li>
              );
            })}
          </ol>
        )}

        {fatal && <div className="mb-6"><ErrorNote error={fatal} onRetry={run} /></div>}

        {(verdict || phase === "verdict") && (
          <Card className="mb-6 p-5">
            <SectionTitle>Verdict</SectionTitle>
            <div className="flex gap-3">
              {verdict && (tone === "good" ? <ThumbsUp className="mt-0.5 size-5 shrink-0 text-good" aria-hidden /> : tone === "bad" ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden /> : <Sparkles className="mt-0.5 size-5 shrink-0 text-test" aria-hidden />)}
              <p className={`text-base leading-relaxed ${phase === "verdict" ? "caret" : ""}`} aria-live="polite">{verdict || "Thinking…"}</p>
            </div>
          </Card>
        )}

        {ideas && (
          <section className="mb-6">
            <SectionTitle>Sharper versions</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {[ideas.sharpened, ...ideas.alternatives].map((idea, i) => (
                <Card key={idea.idea_id} className={`flex flex-col p-4 ${i === 0 ? "border-accent md:col-span-2" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {i === 0 ? <Badge tone="accent">Sharpened</Badge> : <Badge>Alternative {i}</Badge>}
                    <span className="text-xs text-ink-3">{RELATIVE_TEXT[idea.relative as Relative] ?? ""}</span>
                  </div>
                  <h3 className={`mt-2 font-semibold ${i === 0 ? "text-lg" : "text-base"}`}>{idea.title}</h3>
                  <p className="mt-1 flex-1 text-sm text-ink-2">{idea.core_idea}</p>
                  <div className="mt-3">
                    <Button size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => setBriefFor(idea)}>Create brief from this</Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {(versions.length > 0 || (phase === "briefs" && ideas)) && (
          <section className="mb-6">
            <SectionTitle aside={<span className="text-xs text-ink-3">Built from the sharpened version. Saved as drafts until you send one.</span>}>Ready-to-shoot versions</SectionTitle>
            <div role="tablist" aria-label="Platform versions" className="mb-3 flex flex-wrap gap-2">
              {versions.map((v, i) => (
                <button key={v.brief.brief_id} role="tab" aria-selected={active === i} onClick={() => setActive(i)}
                  className={`rounded-lg border px-3 py-1.5 ${active === i ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2"}`}>
                  {v.platform === "general" ? <span className="text-sm font-medium">General</span> : <PlatformBadge platform={v.platform} />}
                </button>
              ))}
              {phase === "briefs" && versions.length < expected && (
                <span className="inline-flex items-center gap-2 px-2 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" aria-hidden />Writing {expected - versions.length} more…</span>
              )}
            </div>
            {versions[active] && <VersionPanel key={versions[active].brief.brief_id} brief={versions[active].brief} />}
          </section>
        )}

        {errors.map((e) => <div key={e} className="mb-3"><ErrorNote error={new Error(e)} /></div>)}
      </div>

      <CreateBriefDialog idea={briefFor ? { idea_id: briefFor.idea_id, title: briefFor.title, platform: platforms[0] ?? null } : null} onClose={() => setBriefFor(null)} />
    </>
  );
}

function VersionPanel({ brief }: { brief: BriefPayload }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const send = useMutation({
    mutationFn: () => api.queueBrief(brief.brief_id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: "Sent to your studio." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  return (
    <div role="tabpanel">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="primary" loading={send.isPending} disabled={send.isSuccess} onClick={() => send.mutate()}
          icon={send.isSuccess ? <Check className="size-4" /> : <Send className="size-4" />}>
          {send.isSuccess ? "Sent to studio" : "Send to studio"}
        </Button>
        <Link to={`/briefs/${brief.brief_id}`} className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-ink-2 hover:bg-surface-2">Open full brief</Link>
      </div>
      <BriefView b={brief} compact />
    </div>
  );
}
