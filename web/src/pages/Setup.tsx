import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Info, PenLine, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BrandBrainForm, GoalPicker, LanguageSelect, brainProblems, cleanBrain } from "../components/BrandBrainForm";
import { CompetitorPicker } from "../components/CompetitorPicker";
import { CompetitorsEditor } from "../components/CompetitorsEditor";
import { NarratedProgress } from "../components/Progress";
import { useToast } from "../components/Toast";
import { WebsiteAnalysis } from "../components/WebsiteAnalysis";
import { ScanPanel } from "../components/ScanPanel";
import { Button, Card, ErrorNote, Field, inputClass, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { IDEA_STEPS } from "../lib/format";
import type { AnalyseInput, BrandBrain, BrandDraft, Goal } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";

const STEPS = ["Your website", "Your brand", "Your products", "Competitors", "First ideas"];

export const EMPTY_BRAIN: BrandBrain = {
  website_url: null, brand_kit: { colors: [], fonts: [] }, social_links: [], goal: "engagement", language: "en-GB",
  tone_words: [], pillars: [], audience: "", buyer_questions: [], objections: [], offers: [], banned_topics: [],
};

/** Fill any gaps so older drafts and partial research still render in the form. */
export function toFormBrain(b: Partial<BrandBrain> | null | undefined): BrandBrain {
  return { ...EMPTY_BRAIN, ...b, brand_kit: { ...EMPTY_BRAIN.brand_kit, ...b?.brand_kit }, social_links: b?.social_links ?? [], offers: b?.offers ?? [] };
}

export function Setup() {
  const ws = useWs();
  const [params, setParams] = useSearchParams();
  const step = Math.min(4, Math.max(0, Number(params.get("step") ?? 0)));
  const go = (n: number) => setParams({ step: String(n) });
  const summary = useSummary();
  // Only ask for a Brand Brain once one exists; a brand-new workspace has none yet.
  const existing = useQuery({ queryKey: ["ws", ws, "brain"], queryFn: () => api.brain(ws), retry: false, enabled: !!summary.data?.brain_exists });

  // Resume: someone with a draft or confirmed brain lands on review, not on step 1.
  useEffect(() => {
    if (!params.get("step") && existing.data) go(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><img src="/favicon.svg" alt="" className="size-7" />{summary.data?.name ?? "Set up"}</div>
          {summary.data?.confirmed_at && <Button variant="ghost" size="sm" onClick={() => window.location.assign("/week")}>Skip to app</Button>}
        </div>
        <ol className="mb-8 grid grid-cols-5 gap-2" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined}>
              <div className={`h-1 rounded-full ${i <= step ? "bg-accent" : "bg-surface-3"}`} />
              <p className={`mt-2 text-xs font-medium ${i === step ? "text-ink" : "text-ink-3"}`}>
                <span className="sr-only">Step {i + 1}: </span>{s}
              </p>
            </li>
          ))}
        </ol>
        {step === 0 && <BasicsStep onDone={() => go(1)} />}
        {step === 1 && <ReviewStep existing={existing.data ?? null} loading={summary.isLoading || (existing.isLoading && existing.fetchStatus !== "idle")} onBack={() => go(0)} onDone={() => go(2)} />}
        {step === 2 && <KnowledgeStep onBack={() => go(1)} onDone={() => go(3)} />}
        {step === 3 && <CompetitorStep onBack={() => go(2)} onDone={() => go(4)} />}
        {step === 4 && <FirstIdeasStep />}
      </div>
    </div>
  );
}

function BasicsStep({ onDone }: { onDone: () => void }) {
  const ws = useWs();
  const cfg = useAppConfig();
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<Goal>("engagement");
  const [language, setLanguage] = useState("");
  const aiReady = cfg.data?.ai_configured;
  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim()) || /^[\w-]+(\.[\w-]+)+/.test(url.trim());
  const normalized = url.trim() ? (url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`) : null;

  const [running, setRunning] = useState<AnalyseInput | null>(null);

  const manual = () => {
    qc.setQueryData<BrandDraft>(["ws", ws, "draft"], {
      brain: { ...EMPTY_BRAIN, website_url: normalized, goal, language: language || navigator.language || "en-GB" },
      name: "", logos: [], competitor_suggestions: [], researched_with_web: false, site_reachable: false,
    });
    onDone();
  };

  if (running) {
    return (
      <Card className="p-6 sm:p-8">
        <WebsiteAnalysis
          ws={ws}
          input={running}
          onDone={({ draft }) => {
            qc.setQueryData(["ws", ws, "draft"], draft);
            qc.invalidateQueries({ queryKey: ["ws", ws, "competitor-suggestions"] });
            qc.invalidateQueries({ queryKey: ["ws", ws, "summary"] });
            onDone();
          }}
          onCancel={() => setRunning(null)}
          onManual={() => { setRunning(null); manual(); }}
        />
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Let's understand your brand</h1>
      <p className="mt-1 text-sm text-ink-2">Enter your website and we'll build your brand profile: what you sell, who buys, your logo, colours, socials and competitors. You review everything before it's used.</p>
      <form className="mt-6 flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (aiReady && validUrl) setRunning({ website_url: normalized!, goal, language: language || null }); else manual(); }}>
        <Field label="Website" htmlFor="site">
          <input id="site" className={inputClass} inputMode="url" autoComplete="url" placeholder="yourcompany.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">What should your posts do most?</span>
          <GoalPicker value={goal} onChange={setGoal} />
          <p className="text-xs text-ink-3">We measure every post against this, not just views.</p>
        </div>
        <Field label="Content language" htmlFor="lang" hint="Scripts and captions are written in this language, with local spelling and currency.">
          <LanguageSelect id="lang" value={language} onChange={setLanguage} allowAuto />
        </Field>
        <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row-reverse sm:justify-start">
          {aiReady ? (
            <>
              <Button type="submit" variant="primary" size="lg" disabled={!validUrl} icon={<Sparkles className="size-4" />}>Analyse my website</Button>
              <Button type="button" variant="ghost" size="lg" onClick={manual} icon={<PenLine className="size-4" />}>Set up manually</Button>
            </>
          ) : (
            <Button type="submit" variant="primary" size="lg">Continue <ArrowRight className="size-4" aria-hidden /></Button>
          )}
        </div>
        {cfg.data && !aiReady && (
          <p className="text-xs text-ink-3">Automatic analysis needs an Anthropic API key on the server, so you'll fill in the next step yourself.</p>
        )}
      </form>
    </Card>
  );
}

function ReviewStep({ existing, loading, onBack, onDone }: {
  existing: (BrandBrain & { name: string; draft: (BrandBrain & { name?: string; logos?: string[] }) | null; confirmed_at: string | null }) | null;
  loading: boolean; onBack: () => void; onDone: () => void;
}) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const summary = useSummary();
  const fresh = qc.getQueryData<BrandDraft>(["ws", ws, "draft"]);
  const saved = existing ? (existing.confirmed_at ? existing : existing.draft ?? existing) : null;
  const [brain, setBrain] = useState<BrandBrain | null>(fresh ? toFormBrain(fresh.brain) : saved ? toFormBrain(saved) : null);
  const [name, setName] = useState(fresh?.name || existing?.draft?.name || summary.data?.name || "");
  const logos = fresh?.logos ?? existing?.draft?.logos ?? [];
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!brain && saved) setBrain(toFormBrain(saved));
    if (!name && (existing?.draft?.name || summary.data?.name)) setName(existing?.draft?.name || summary.data!.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, summary.data]);

  const save = useMutation({
    mutationFn: async (b: BrandBrain) => {
      if (name.trim() && name.trim() !== summary.data?.name) await api.renameWorkspace(ws, name.trim());
      await api.confirmBrain(ws, { ...b, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, trends_geo: b.country ?? b.language.split("-")[1] ?? null });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); qc.invalidateQueries({ queryKey: ["workspaces"] }); onDone(); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  if (loading && !brain) return <Card className="space-y-4 p-8"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-24" /></Card>;
  if (!brain) {
    return <Card className="p-8"><p className="text-sm">Start with your website first.</p><Button className="mt-4" onClick={onBack}>Back</Button></Card>;
  }
  const problems = brainProblems(brain);
  const researched = !!fresh && (fresh.brain.offers.length > 0 || !!fresh.brain.description);

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex items-start gap-3">
        {researched && <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-good-soft text-good"><Check className="size-5" aria-hidden /></div>}
        <div>
          <h1 className="text-xl font-semibold">{researched ? "Your brand is ready" : "Your brand"}</h1>
          <p className="mt-1 text-sm text-ink-2">Review every part before continuing. Every idea and brief is built on this, and you can change it any time in Settings.</p>
        </div>
      </div>
      {fresh?.warnings?.length ? (
        <div className="mt-4 flex gap-2 rounded-lg bg-test-soft px-3 py-2 text-sm text-test">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Some parts need your help</p>
            <ul className="mt-1 list-inside list-disc">{fresh.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        </div>
      ) : fresh && !fresh.site_reachable && fresh.researched_with_web ? (
        <p className="mt-4 flex gap-2 rounded-lg bg-test-soft px-3 py-2 text-sm text-test">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your website couldn't be read directly, so this came from web research. Check it closely.
        </p>
      ) : null}
      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); setShowErrors(true); if (!problems.length) save.mutate(cleanBrain(brain)); }}>
        <BrandBrainForm value={brain} onChange={setBrain} name={name} onNameChange={setName} logos={logos} />
        {showErrors && problems.length > 0 && (
          <ul role="alert" className="mt-6 list-inside list-disc rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="sticky bottom-0 -mx-6 mt-8 flex justify-between gap-2 border-t border-line bg-surface px-6 py-4 sm:-mx-8 sm:px-8">
          <Button type="button" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>Continue <ArrowRight className="size-4" aria-hidden /></Button>
        </div>
      </form>
    </Card>
  );
}

function CompetitorStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const ws = useWs();
  const summary = useSummary();
  const cfg = useAppConfig();
  const [manual, setManual] = useState(false);
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Who do you compete with?</h1>
      <p className="mt-1 text-sm text-ink-2">
        Based on what you sell and where. Pick up to {cfg.data?.max_competitors ?? 5}, or let the AI choose. When one of their posts does far better than their usual, it becomes evidence for your ideas. Public data only.
      </p>
      <div className="mt-6"><CompetitorPicker ws={ws} /></div>
      <div className="mt-6 border-t border-line pt-5">
        <button className="text-sm font-medium text-ink-2 hover:text-ink" aria-expanded={manual} onClick={() => setManual((m) => !m)}>
          {manual ? "Hide" : "Missing someone? Add a competitor yourself"}
        </button>
        {manual && <div className="mt-4"><CompetitorsEditor ws={ws} /></div>}
      </div>
      <div className="mt-8 flex justify-between gap-2 border-t border-line pt-5">
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <Button variant="primary" onClick={onDone}>{summary.data?.competitors ? "Continue" : "Skip for now"} <ArrowRight className="size-4" aria-hidden /></Button>
      </div>
    </Card>
  );
}

/** Every page of every site the business owns: products, services, proof, prices, FAQs. */
function KnowledgeStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const cfg = useAppConfig();
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Find everything you sell</h1>
      <p className="mt-1 text-sm text-ink-2">
        We go beyond your homepage: your sitemap, menus and linked sites (like a separate product site), then read the pages about products, services,
        pricing, case studies and FAQs. Every fact keeps a link to where it came from, and ideas only use numbers found there.
      </p>
      <div className="mt-6">{cfg.data?.ai_configured ? <ScanPanel /> : <p className="text-sm text-ink-2">Reading pages needs an Anthropic API key on the server. You can add facts by hand later in Knowledge.</p>}</div>
      <div className="mt-8 flex justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <Button variant="primary" onClick={onDone}>Continue <ArrowRight className="size-4" aria-hidden /></Button>
      </div>
      <p className="mt-2 text-right text-xs text-ink-3">The scan keeps going in the background if you continue; review the facts later in Knowledge.</p>
    </Card>
  );
}

function FirstIdeasStep() {
  const ws = useWs();
  const cfg = useAppConfig();
  const nav = useNavigate();
  const qc = useQueryClient();
  const gen = useMutation({
    mutationFn: () => api.generateIdeas(ws),
    onSuccess: (r) => { qc.setQueryData(["ws", ws, "ideas"], r.ideas); qc.invalidateQueries({ queryKey: ["ws", ws, "summary"] }); },
  });
  const started = gen.isPending || gen.isSuccess || gen.isError;
  useEffect(() => {
    if (cfg.data?.ai_configured && !started) gen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.data?.ai_configured]);

  const finish = () => nav("/week");

  if (cfg.data && !cfg.data.ai_configured) {
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold">You're set up</h1>
        <p className="mt-2 text-sm text-ink-2">
          Idea generation needs an Anthropic API key on the server (<code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code>). Once it's set, press "Generate ideas" on the This week page.
        </p>
        <AccountsNote />
        <Button className="mt-6" variant="primary" size="lg" onClick={finish}>Go to This week <ArrowRight className="size-4" aria-hidden /></Button>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      {gen.isSuccess ? (
        <>
          <div className="grid size-10 place-items-center rounded-full bg-good-soft text-good"><Check className="size-5" aria-hidden /></div>
          <h1 className="mt-4 text-xl font-semibold">{gen.data.ideas.length} ideas are ready</h1>
          <p className="mt-1 text-sm text-ink-2">
            The best {gen.data.ideas.length}{gen.data.drafted ? ` of ${gen.data.drafted} drafts` : ""}, each tied to what you sell and where your buyer is. Pick one and we'll write a brief your studio can shoot. New ideas arrive every night, and they get sharper as your posts come in.
          </p>
          <AccountsNote />
          <Button className="mt-6" variant="primary" size="lg" onClick={finish}>See this week's ideas <ArrowRight className="size-4" aria-hidden /></Button>
        </>
      ) : gen.isError ? (
        <>
          <h1 className="text-xl font-semibold">Your first ideas didn't come through</h1>
          <div className="mt-4"><ErrorNote error={gen.error} onRetry={() => gen.mutate()} /></div>
          <Button className="mt-6" variant="ghost" onClick={finish}>Continue without them</Button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Writing your first ideas…</h1>
          <p className="mt-1 text-sm text-ink-2">Usually one to two minutes. Please keep this tab open.</p>
          <div className="mt-6">
            <NarratedProgress intervalMs={14000} steps={IDEA_STEPS} />
          </div>
        </>
      )}
    </Card>
  );
}

function AccountsNote() {
  return (
    <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink-2">
      <span className="font-medium text-ink">Analytics:</span> your content studio connects your Instagram, TikTok, YouTube, Facebook and LinkedIn accounts. Once they're connected, results appear in Analytics on their own.
    </p>
  );
}
