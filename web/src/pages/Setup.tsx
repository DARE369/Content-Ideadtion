import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, PenLine, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BrandBrainForm, GoalPicker, LanguageSelect, brainProblems, cleanBrain } from "../components/BrandBrainForm";
import { CompetitorsEditor } from "../components/CompetitorsEditor";
import { NarratedProgress } from "../components/Progress";
import { useToast } from "../components/Toast";
import { Button, Card, ErrorNote, Field, inputClass, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import type { BrandBrain, Goal } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";

const STEPS = ["Your brand", "Brand Brain", "Competitors", "First ideas"];

const EMPTY: BrandBrain = {
  website_url: null, brand_kit: { colors: [], fonts: [] }, goal: "engagement", language: "en-NG",
  tone_words: [], pillars: [], audience: "", offers: [], banned_topics: [],
};

function guessLanguage(): string {
  const l = navigator.language || "en-GB";
  return /^[a-z]{2}-[A-Z]{2}$/.test(l) ? l : "en-GB";
}

export function Setup() {
  const ws = useWs();
  const [params, setParams] = useSearchParams();
  const step = Math.min(3, Math.max(0, Number(params.get("step") ?? 0)));
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
        <ol className="mb-8 grid grid-cols-4 gap-2" aria-label="Setup progress">
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
        {step === 2 && <CompetitorStep onBack={() => go(1)} onDone={() => go(3)} />}
        {step === 3 && <FirstIdeasStep />}
      </div>
    </div>
  );
}

function BasicsStep({ onDone }: { onDone: () => void }) {
  const ws = useWs();
  const cfg = useAppConfig();
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<Goal>("engagement");
  const [language, setLanguage] = useState(guessLanguage);
  const aiReady = cfg.data?.ai_configured;
  const validUrl = /^https?:\/\/\S+\.\S+/.test(url.trim()) || /^[\w-]+(\.[\w-]+)+/.test(url.trim());
  const normalized = url.trim() ? (url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`) : null;

  const draft = useMutation({
    mutationFn: () => api.draftBrain(ws, { website_url: normalized!, goal, language }),
    onSuccess: (b) => { qc.setQueryData(["ws", ws, "draft"], { ...b, goal, language }); onDone(); },
    onError: (e) => toast({ tone: "error", message: `Couldn't draft it: ${e.message} You can fill it in yourself instead.` }),
  });

  const manual = () => {
    qc.setQueryData(["ws", ws, "draft"], { ...EMPTY, website_url: normalized, goal, language });
    onDone();
  };

  if (draft.isPending) {
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold">Reading your website…</h1>
        <p className="mt-1 text-sm text-ink-2">This takes about 15 seconds. You'll check everything next.</p>
        <div className="mt-6">
          <NarratedProgress intervalMs={3500} steps={["Fetching your website", "Working out who you sell to", "Finding 3–5 content pillars", "Listing your offers", "Picking your tone of voice"]} />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Tell us the basics</h1>
      <p className="mt-1 text-sm text-ink-2">We'll draft your Brand Brain from your website. You stay in control of every word.</p>
      <form className="mt-6 flex flex-col gap-6" onSubmit={(e) => { e.preventDefault(); if (aiReady && validUrl) draft.mutate(); else manual(); }}>
        <Field label="Website" htmlFor="site" hint="Your homepage or shop page.">
          <input id="site" className={inputClass} inputMode="url" autoComplete="url" placeholder="yourbrand.com" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium" id="goal-label">What should your posts do most?</span>
          <GoalPicker value={goal} onChange={setGoal} />
          <p className="text-xs text-ink-3">We measure every post against this, not just views.</p>
        </div>
        <Field label="Content language" htmlFor="lang" hint="Scripts and captions are written in this language, with local spelling and currency.">
          <LanguageSelect id="lang" value={language} onChange={setLanguage} />
        </Field>
        <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row-reverse sm:justify-start">
          {aiReady ? (
            <>
              <Button type="submit" variant="primary" size="lg" disabled={!validUrl} icon={<Sparkles className="size-4" />}>Draft it from my website</Button>
              <Button type="button" variant="ghost" size="lg" onClick={manual} icon={<PenLine className="size-4" />}>I'll fill it in myself</Button>
            </>
          ) : (
            <Button type="submit" variant="primary" size="lg">Continue <ArrowRight className="size-4" aria-hidden /></Button>
          )}
        </div>
        {cfg.data && !aiReady && (
          <p className="text-xs text-ink-3">Automatic drafting needs an Anthropic API key on the server, so you'll fill in the next step yourself. It takes about 3 minutes.</p>
        )}
      </form>
    </Card>
  );
}

function ReviewStep({ existing, loading, onBack, onDone }: { existing: (BrandBrain & { draft: BrandBrain | null; confirmed_at: string | null }) | null; loading: boolean; onBack: () => void; onDone: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const fresh = qc.getQueryData<BrandBrain>(["ws", ws, "draft"]);
  const initial: BrandBrain | null = fresh ?? (existing ? (existing.confirmed_at ? existing : existing.draft ?? existing) : null);
  const [brain, setBrain] = useState<BrandBrain | null>(initial ? { ...EMPTY, ...initial, brand_kit: { ...EMPTY.brand_kit, ...initial.brand_kit } } : null);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!brain && initial) setBrain({ ...EMPTY, ...initial, brand_kit: { ...EMPTY.brand_kit, ...initial.brand_kit } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const save = useMutation({
    mutationFn: (b: BrandBrain) => api.confirmBrain(ws, { ...b, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, trends_geo: b.language.split("-")[1] ?? null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); onDone(); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  if (loading && !brain) return <Card className="space-y-4 p-8"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-24" /></Card>;
  if (!brain) {
    return <Card className="p-8"><p className="text-sm">Start with the basics first.</p><Button className="mt-4" onClick={onBack}>Back</Button></Card>;
  }
  const problems = brainProblems(brain);

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">{fresh?.pillars.length ? "Here's what we understood" : "Your Brand Brain"}</h1>
      <p className="mt-1 text-sm text-ink-2">
        {fresh?.pillars.length ? "Check it and fix anything that's off. Every idea and brief is built on this." : "Every idea and brief is built on this. You can change it any time in Settings."}
      </p>
      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); setShowErrors(true); if (!problems.length) save.mutate(cleanBrain(brain)); }}>
        <BrandBrainForm value={brain} onChange={setBrain} />
        {showErrors && problems.length > 0 && (
          <ul role="alert" className="mt-6 list-inside list-disc rounded-lg bg-bad-soft px-4 py-3 text-sm text-bad">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="sticky bottom-0 -mx-6 mt-8 flex justify-between gap-2 border-t border-line bg-surface px-6 py-4 sm:-mx-8 sm:px-8">
          <Button type="button" variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
          <Button type="submit" variant="primary" loading={save.isPending} icon={<Check className="size-4" />}>Looks right</Button>
        </div>
      </form>
    </Card>
  );
}

function CompetitorStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const ws = useWs();
  const summary = useSummary();
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-semibold">Who do you keep an eye on?</h1>
      <p className="mt-1 text-sm text-ink-2">
        Up to 5 brands in your space. When one of their posts does far better than their usual, it becomes evidence for your ideas. We only use public data.
      </p>
      <div className="mt-6"><CompetitorsEditor ws={ws} /></div>
      <div className="mt-8 flex justify-between gap-2 border-t border-line pt-5">
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft className="size-4" />}>Back</Button>
        <Button variant="primary" onClick={onDone}>{summary.data?.competitors ? "Continue" : "Skip for now"} <ArrowRight className="size-4" aria-hidden /></Button>
      </div>
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
            Pick one and we'll write a brief your studio can shoot. New ideas arrive every night, and they get sharper as your posts come in.
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
          <p className="mt-1 text-sm text-ink-2">Usually under a minute. Please keep this tab open.</p>
          <div className="mt-6">
            <NarratedProgress intervalMs={9000} steps={[
              "Reading your Brand Brain and audience",
              "Looking at what already works for you",
              "Checking competitor winners and trends",
              "Writing 15 ideas",
              "An editor is cutting the weak ones",
              "Scoring and picking this week's shortlist",
            ]} />
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
