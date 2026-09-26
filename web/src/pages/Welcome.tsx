import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, Lightbulb, RefreshCcw, Send, Store } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../components/Toast";
import { Button, Card, Field, inputClass } from "../components/ui";
import { api } from "../lib/api";
import { useWorkspace } from "../lib/workspace";

const LOOP = [
  { icon: Lightbulb, title: "Ideas grounded in your results", text: "Your own best posts, your audience's questions, competitor winners and what's trending." },
  { icon: Send, title: "Briefs your studio can shoot", text: "One native brief per platform: hooks, beats, script, caption and call to action." },
  { icon: BarChart3, title: "Honest analytics", text: "Every post measured against your own usual, not someone else's." },
  { icon: RefreshCcw, title: "It learns what works for you", text: "Winning patterns get reused; a few new ones get tested so you keep improving." },
];

export function Welcome() {
  const [name, setName] = useState("");
  const { setWorkspace, workspaceId } = useWorkspace();
  const nav = useNavigate();
  const toast = useToast();
  const existing = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces });

  const create = useMutation({
    mutationFn: () => api.createWorkspace(name.trim()),
    onSuccess: ({ workspace_id }) => { setWorkspace(workspace_id); nav("/setup"); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const demo = useMutation({
    mutationFn: api.seedDemo,
    onSuccess: ({ workspace_id }) => { setWorkspace(workspace_id); nav("/week"); toast({ tone: "success", message: "Demo bakery loaded. Look around; nothing here is real." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  return (
    <div className="min-h-dvh">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-20">
        <section>
          <div className="mb-8 flex items-center gap-2 text-sm font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" /> Ideation
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Know what to post next,<br className="hidden sm:block" /> and see it working.
          </h1>
          <p className="mt-4 max-w-lg text-base text-ink-2">
            Every week you get a short list of post ideas built from what already works for your brand. Pick one, and your studio gets a brief it can shoot.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {LOOP.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-accent ring-1 ring-line"><Icon className="size-4" aria-hidden /></span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-0.5 text-sm text-ink-2">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Set up your brand</h2>
            <p className="mt-1 text-sm text-ink-2">About 5 minutes. We draft most of it from your website.</p>
            <form className="mt-5 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
              <Field label="Brand name" htmlFor="brand-name">
                <input id="brand-name" className={inputClass} placeholder="e.g. Crumb & Co." value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={create.isPending} disabled={!name.trim()}>
                Get started <ArrowRight className="size-4" aria-hidden />
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="text-base font-semibold">Just looking?</h2>
            <p className="mt-1 text-sm text-ink-2">Open a demo bakery with 12 weeks of posts, ideas, briefs and a weekly report. No setup or keys needed.</p>
            <Button className="mt-4 w-full" size="lg" loading={demo.isPending} onClick={() => demo.mutate()}>Explore the demo</Button>
          </Card>

          {!!existing.data?.length && (
            <Card className="p-6">
              <h2 className="text-base font-semibold">Continue where you left off</h2>
              <ul className="mt-3 divide-y divide-line">
                {existing.data.slice(0, 6).map((w) => (
                  <li key={w.id}>
                    <button
                      onClick={() => { setWorkspace(w.id); nav(w.brain_confirmed ? "/week" : "/setup"); }}
                      className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:text-accent"
                    >
                      <Store className="size-4 text-ink-3" aria-hidden />
                      <span className="flex-1 truncate font-medium">{w.name}</span>
                      <span className="text-xs text-ink-3">{w.id === workspaceId ? "Current" : w.brain_confirmed ? "Ready" : "Setup unfinished"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
