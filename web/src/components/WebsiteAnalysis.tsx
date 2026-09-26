import { AlertTriangle, Check, Loader2, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, isCancelled } from "../lib/api";
import type { AnalyseInput, BrandDraft } from "../lib/types";
import { Button } from "./ui";

type StageId = "site" | "research" | "finish";
type State = "todo" | "active" | "done" | "warn" | "failed";

/**
 * Each stage is its own request with its own time limit. The page shows the
 * stage that is really running; the sub-steps inside a stage are narration and
 * never run ahead of the server. Only the last stage can stop the analysis, and
 * even then the person can retry it or fill the form in themselves.
 */
const STAGES: { id: StageId; steps: string[]; stepMs: number; timeoutMs: number }[] = [
  { id: "site", steps: ["Scanning your website", "Extracting your logo and colours", "Finding your social profiles"], stepMs: 5_000, timeoutMs: 60_000 },
  { id: "research", steps: ["Researching what you sell and what earns the money", "Working out who buys from you", "Finding competitors in your market"], stepMs: 25_000, timeoutMs: 150_000 },
  { id: "finish", steps: ["Preparing your brand"], stepMs: 10_000, timeoutMs: 90_000 },
];

const SLOW_AFTER_S = 120;

export interface AnalysisResult { draft: BrandDraft; warnings: string[] }

export function WebsiteAnalysis({ ws, input, title = "Analysing your brand…", onDone, onCancel, onManual }: {
  ws: string;
  input: AnalyseInput;
  title?: string;
  onDone: (r: AnalysisResult) => void;
  onCancel: () => void;
  onManual: () => void;
}) {
  const [states, setStates] = useState<Record<StageId, State>>({ site: "todo", research: "todo", finish: "todo" });
  const [stageWarnings, setStageWarnings] = useState<Partial<Record<StageId, string>>>({});
  const [failure, setFailure] = useState<{ stage: StageId; message: string } | null>(null);
  const [stageStarted, setStageStarted] = useState(Date.now());
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [attempt, setAttempt] = useState<{ from: StageId; n: number }>({ from: "site", n: 0 });
  const abort = useRef<AbortController | null>(null);
  // Warnings from stages that already finished survive a retry of a later stage.
  const warningsRef = useRef<Partial<Record<StageId, string>>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    const set = (id: StageId, s: State) => setStates((x) => ({ ...x, [id]: s }));
    const warn = (id: StageId, w: string | undefined) => {
      if (!w) return;
      warningsRef.current = { ...warningsRef.current, [id]: w };
      setStageWarnings(warningsRef.current);
    };
    const begin = (id: StageId) => { set(id, "active"); setStageStarted(Date.now()); };
    const opts = (id: StageId) => ({ signal: ctrl.signal, timeoutMs: STAGES.find((s) => s.id === id)!.timeoutMs });
    const order: StageId[] = ["site", "research", "finish"];
    const skip = order.indexOf(attempt.from);

    (async () => {
      setFailure(null);
      try {
        if (skip <= 0) {
          begin("site");
          try {
            const r = await api.analyseSite(ws, input, opts("site"));
            set("site", r.ok ? "done" : "warn");
            warn("site", r.warning);
          } catch (e) {
            if (isCancelled(e)) throw e;
            // A bad address is worth stopping for; anything else, carry on with web research.
            if (e instanceof ApiError && e.status === 400) {
              set("site", "failed");
              setFailure({ stage: "site", message: "That website address doesn't look right. Check it and try again." });
              return;
            }
            set("site", "warn");
            warn("site", "Reading your website took too long, so we'll rely on web research.");
          }
        }
        if (skip <= 1) {
          begin("research");
          try {
            const r = await api.analyseResearch(ws, input, opts("research"));
            set("research", r.ok ? (r.warning ? "warn" : "done") : "warn");
            warn("research", r.warning);
          } catch (e) {
            if (isCancelled(e)) throw e;
            set("research", "warn");
            warn("research", "Web research didn't finish in time, so your draft is based on your website.");
          }
        }
        begin("finish");
        try {
          const d = await api.analyseFinish(ws, input, opts("finish"));
          set("finish", d.warnings.length ? "warn" : "done");
          const warnings = [...Object.values(warningsRef.current), ...d.warnings].filter((w): w is string => !!w);
          onDone({ draft: { ...d, warnings }, warnings });
        } catch (e) {
          if (isCancelled(e)) throw e;
          set("finish", "failed");
          setFailure({ stage: "finish", message: e instanceof Error ? e.message : "Something went wrong." });
        }
      } catch (e) {
        if (!isCancelled(e)) throw e;
      }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const elapsed = Math.floor((now - started) / 1000);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  const retry = (from: StageId) => {
    setStates((x) => {
      const order: StageId[] = ["site", "research", "finish"];
      const next = { ...x };
      for (const id of order.slice(order.indexOf(from))) next[id] = "todo";
      return next;
    });
    setAttempt((a) => ({ from, n: a.n + 1 }));
  };

  if (failure) {
    return (
      <div>
        <div className="grid size-11 place-items-center rounded-xl bg-bad-soft text-bad"><AlertTriangle className="size-5" aria-hidden /></div>
        <h1 className="mt-4 text-xl font-semibold">We couldn't finish analysing your brand</h1>
        <p className="mt-1 text-sm text-ink-2" role="alert">{failure.message}</p>
        <p className="mt-3 text-sm text-ink-2">
          {failure.stage === "site"
            ? "Nothing was saved."
            : "What we found so far is kept, so trying again only redoes the last step. Or skip it and fill in your brand yourself; it takes about five minutes."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {failure.stage === "site" ? (
            <Button variant="primary" onClick={onCancel}>Change the website</Button>
          ) : (
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => retry(failure.stage)}>Try again</Button>
          )}
          <Button variant="ghost" icon={<PenLine className="size-4" />} onClick={onManual}>Fill it in myself</Button>
          {failure.stage !== "site" && <Button variant="ghost" onClick={onCancel}>Back</Button>}
        </div>
      </div>
    );
  }

  const active = STAGES.find((s) => states[s.id] === "active");
  const inStage = active ? Math.min(active.steps.length - 1, Math.floor((now - stageStarted) / active.stepMs)) : 0;

  return (
    <div>
      <div className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><Sparkles className="size-5" aria-hidden /></div>
      <h1 className="mt-4 text-xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-ink-2">We're reading your website and researching your business on the web. Usually 1–3 minutes; keep this tab open.</p>
      <ol className="mt-6 flex flex-col gap-3" aria-live="polite">
        {STAGES.map((stage) => stage.steps.map((step, n) => {
          const s = states[stage.id];
          const state: State = s === "active" ? (n < inStage ? "done" : n === inStage ? "active" : "todo") : s;
          const warning = n === stage.steps.length - 1 ? stageWarnings[stage.id] : undefined;
          return (
            <li key={step} className="flex gap-3 text-sm">
              <StepIcon state={state} />
              <div className={state === "todo" ? "text-ink-3" : "text-ink"}>
                {step}
                {warning && <p className="mt-0.5 text-xs text-test">{warning}</p>}
              </div>
            </li>
          );
        }))}
      </ol>
      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs tabular-nums text-ink-3">
          {clock} elapsed
          {elapsed >= SLOW_AFTER_S && " · Taking longer than usual. You can keep waiting, or skip and fill it in yourself."}
        </p>
        <div className="flex gap-2">
          {elapsed >= SLOW_AFTER_S && <Button size="sm" variant="ghost" icon={<PenLine className="size-4" />} onClick={() => { abort.current?.abort(); onManual(); }}>Fill it in myself</Button>}
          <Button size="sm" variant="ghost" onClick={() => { abort.current?.abort(); onCancel(); }}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function StepIcon({ state }: { state: State }) {
  const cls = {
    done: "bg-good-soft text-good", active: "bg-accent-soft text-accent", todo: "bg-surface-2",
    warn: "bg-test-soft text-test", failed: "bg-bad-soft text-bad",
  }[state];
  return (
    <span className={`grid size-6 shrink-0 place-items-center rounded-full ${cls}`}>
      {state === "done" ? <Check className="size-3.5" aria-label="Done" />
        : state === "active" ? <Loader2 className="size-3.5 animate-spin" aria-label="In progress" />
        : state === "warn" ? <AlertTriangle className="size-3.5" aria-label="Done with a problem" />
        : state === "failed" ? <AlertTriangle className="size-3.5" aria-label="Failed" />
        : <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />}
    </span>
  );
}
