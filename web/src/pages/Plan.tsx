import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, FileText, Flag, Pencil, Plus, Sparkles, Target, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PlatformBadge } from "../components/bits";
import { CreateBriefDialog } from "../components/CreateBriefDialog";
import { Dialog } from "../components/Dialog";
import { NarratedProgress } from "../components/Progress";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, inputClass, PageHeader, Skeleton, textareaClass } from "../components/ui";
import { api } from "../lib/api";
import { multiple, PLATFORM_META, STAGE_TEXT } from "../lib/format";
import { CAMPAIGN_GOALS, type Campaign, type CampaignIdea, type CampaignInput, type IdeaCard, type Objective, type ObjectiveInput, type Platform, type Product } from "../lib/types";
import { useAppConfig, useSummary, useWs } from "../lib/workspace";

const GOAL_LABEL: Record<(typeof CAMPAIGN_GOALS)[number], string> = {
  awareness: "Awareness", leads: "Leads", sales: "Sales", launch: "Launch", event: "Event", retention: "Retention",
};

export function PlanPage() {
  const { tab = "growth", id } = useParams();
  const nav = useNavigate();
  if (tab === "campaigns" && id) return <CampaignDetail id={id} />;
  return (
    <>
      <PageHeader title="Plan" subtitle="Your business development objectives for the quarter, and the campaigns that serve them. Ideas and briefs follow this plan." />
      <div role="tablist" aria-label="Plan" className="mb-6 flex gap-1 border-b border-line">
        {([["growth", "Growth plan"], ["campaigns", "Campaigns"]] as const).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => nav(`/plan/${t}`)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {tab === "growth" ? <GrowthTab /> : <CampaignsTab />}
    </>
  );
}

function useProducts() {
  const ws = useWs();
  return useQuery({ queryKey: ["ws", ws, "products"], queryFn: () => api.products(ws) });
}

function ProductPicker({ value, onChange, products }: { value: string[]; onChange: (v: string[]) => void; products: Product[] }) {
  const confirmed = products.filter((p) => p.confirmed);
  if (!confirmed.length) return <p className="text-sm text-ink-2">No products yet. <Link className="underline" to="/knowledge/products">Add them in Knowledge</Link>.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {confirmed.map((p) => {
        const on = value.includes(p.id);
        return (
          <button key={p.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            className={`rounded-md px-2.5 py-1 text-sm ${on ? "bg-accent-soft text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>{p.name}</button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Growth plan
// ---------------------------------------------------------------------------

const EMPTY_OBJECTIVE: ObjectiveInput = {
  title: "", period_start: null, period_end: null, segment: "", product_ids: [], motion: [], stage_messages: {}, success_metric: "",
  target_value: null, current_value: null, weight: 5, status: "active",
};

function GrowthTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const cfg = useAppConfig();
  const objectives = useQuery({ queryKey: ["ws", ws, "objectives"], queryFn: () => api.objectives(ws) });
  const products = useProducts();
  const [editing, setEditing] = useState<{ o: ObjectiveInput; id?: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<ObjectiveInput[]>([]);
  const del = useMutation({ mutationFn: (id: string) => api.deleteObjective(ws, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws] }) });
  const saveDraft = useMutation({
    mutationFn: (o: ObjectiveInput) => api.saveObjective(ws, o),
    onSuccess: (_r, o) => { setDrafts((d) => d.filter((x) => x !== o)); qc.invalidateQueries({ queryKey: ["ws", ws] }); },
  });
  if (objectives.isLoading) return <Skeleton className="h-64" />;
  const list = objectives.data ?? [];
  const active = list.filter((o) => o.status === "active");
  const total = active.reduce((s, o) => s + o.weight, 0) || 1;
  const pname = (id: string) => products.data?.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="flex flex-col gap-6">
      {list.length === 0 && !drafts.length ? (
        <EmptyState icon={<Target className="size-8" />} title="What must your content achieve this quarter?"
          action={<div className="flex flex-wrap justify-center gap-2">
            {cfg.data?.ai_configured && <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => setDrafting(true)}>Draft it with me (5 questions)</Button>}
            <Button onClick={() => setEditing({ o: EMPTY_OBJECTIVE })}>Write one myself</Button>
          </div>}>
          Set 2–4 business development objectives, like "Win 3 new operators via the readiness assessment". Ideas are then split between them, and each idea says which one it serves.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            {cfg.data?.ai_configured && <Button icon={<Sparkles className="size-4" />} onClick={() => setDrafting(true)}>Draft with AI</Button>}
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing({ o: EMPTY_OBJECTIVE })}>Add objective</Button>
          </div>
          {drafts.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Suggested objectives: keep, edit or discard</h2>
              <ul className="flex flex-col gap-3">
                {drafts.map((d, i) => (
                  <li key={i}>
                    <Card className="border-accent/40 p-4">
                      <ObjectiveBody o={d} share={null} pname={pname} />
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="primary" loading={saveDraft.isPending && saveDraft.variables === d} onClick={() => saveDraft.mutate(d)}>Keep</Button>
                        <Button size="sm" onClick={() => { setDrafts((x) => x.filter((y) => y !== d)); setEditing({ o: d }); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDrafts((x) => x.filter((y) => y !== d))}>Discard</Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ul className="flex flex-col gap-3">
            {list.map((o) => (
              <li key={o.id}>
                <Card className={`p-4 ${o.status !== "active" ? "opacity-70" : ""}`}>
                  <ObjectiveBody o={o} share={o.status === "active" ? Math.round((o.weight / total) * 100) : null} pname={pname} />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing({ o, id: o.id })}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => { if (window.confirm("Delete this objective?")) del.mutate(o.id); }}>Delete</Button>
                    <span className="ml-auto text-xs text-ink-3">{o.campaigns ?? 0} {o.campaigns === 1 ? "campaign" : "campaigns"} · {o.ideas ?? 0} {o.ideas === 1 ? "idea" : "ideas"}</span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <ObjectiveDialog initial={editing.o} id={editing.id} products={products.data ?? []} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["ws", ws] }); }} />}
      {drafting && <GrowthDraftDialog onClose={(d) => { setDrafting(false); if (d) setDrafts(d); }} />}
    </div>
  );
}

function ObjectiveBody({ o, share, pname }: { o: ObjectiveInput; share: number | null; pname: (id: string) => string }) {
  const progress = o.target_value ? Math.min(1, (o.current_value ?? 0) / o.target_value) : null;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-start gap-2 font-semibold"><Flag className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />{o.title}</p>
        {share != null && <Badge tone="accent">{share}% of ideas</Badge>}
        {o.status !== "active" && <Badge>{o.status}</Badge>}
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {o.segment && <div><dt className="inline text-ink-3">Who: </dt><dd className="inline">{o.segment}</dd></div>}
        {o.product_ids.length > 0 && <div><dt className="inline text-ink-3">Products: </dt><dd className="inline">{o.product_ids.map(pname).filter(Boolean).join(", ")}</dd></div>}
        {o.motion.length > 0 && <div className="sm:col-span-2"><dt className="inline text-ink-3">Path to a sale: </dt><dd className="inline">{o.motion.join(" → ")}</dd></div>}
      </dl>
      {o.success_metric && (
        <div className="mt-3">
          <p className="text-sm"><span className="text-ink-3">Success: </span>{o.success_metric}{o.target_value != null && <> · <span className="font-medium">{o.current_value ?? 0} of {o.target_value}</span></>}</p>
          {progress != null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-good" style={{ width: `${progress * 100}%` }} /></div>}
        </div>
      )}
    </>
  );
}

function ObjectiveDialog({ initial, id, products, onClose }: { initial: ObjectiveInput; id?: string; products: Product[]; onClose: () => void }) {
  const ws = useWs();
  const [o, setO] = useState<ObjectiveInput>(initial);
  const [motion, setMotion] = useState(initial.motion.join(" → "));
  const set = (p: Partial<ObjectiveInput>) => setO((x) => ({ ...x, ...p }));
  const save = useMutation({
    mutationFn: () => api.saveObjective(ws, { ...o, segment: o.segment || null, success_metric: o.success_metric || null, motion: motion.split(/→|->|,|>/).map((s) => s.trim()).filter(Boolean) }, id),
    onSuccess: onClose,
  });
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return (
    <Dialog open wide onClose={onClose} title={id ? "Edit objective" : "New objective"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={o.title.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Objective" htmlFor="ob-title" hint="Specific and measurable, e.g. Win 3 new upstream operators in Nigeria via the readiness assessment">
          <input id="ob-title" className={inputClass} value={o.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Who it targets" htmlFor="ob-seg"><input id="ob-seg" className={inputClass} value={o.segment ?? ""} onChange={(e) => set({ segment: e.target.value })} /></Field>
        <div className="flex flex-col gap-1.5"><span className="text-sm font-medium">Products it depends on</span><ProductPicker value={o.product_ids} onChange={(v) => set({ product_ids: v })} products={products} /></div>
        <Field label="Path to a sale" htmlFor="ob-motion" hint="The usual steps, e.g. assessment → pilot → contract"><input id="ob-motion" className={inputClass} value={motion} onChange={(e) => setMotion(e.target.value)} /></Field>
        {(["awareness", "consideration", "decision"] as const).map((s) => (
          <Field key={s} label={`Message at the ${STAGE_TEXT[s]!.label.toLowerCase()} stage`} htmlFor={`ob-${s}`}>
            <input id={`ob-${s}`} className={inputClass} value={o.stage_messages[s] ?? ""} onChange={(e) => set({ stage_messages: { ...o.stage_messages, [s]: e.target.value } })} />
          </Field>
        ))}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Success measure" htmlFor="ob-metric"><input id="ob-metric" className={inputClass} value={o.success_metric ?? ""} onChange={(e) => set({ success_metric: e.target.value })} placeholder="e.g. new contracts" /></Field>
          <Field label="Target" htmlFor="ob-target"><input id="ob-target" type="number" className={inputClass} value={o.target_value ?? ""} onChange={(e) => set({ target_value: num(e.target.value) })} /></Field>
          <Field label="So far" htmlFor="ob-current" hint="Update by hand for now"><input id="ob-current" type="number" className={inputClass} value={o.current_value ?? ""} onChange={(e) => set({ current_value: num(e.target.value) })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Weight (share of ideas)" htmlFor="ob-weight" hint="1–10, relative to other objectives"><input id="ob-weight" type="number" min={0} max={10} className={inputClass} value={o.weight} onChange={(e) => set({ weight: Number(e.target.value) || 0 })} /></Field>
          <Field label="From" htmlFor="ob-from"><input id="ob-from" type="date" className={inputClass} value={o.period_start ?? ""} onChange={(e) => set({ period_start: e.target.value || null })} /></Field>
          <Field label="To" htmlFor="ob-to"><input id="ob-to" type="date" className={inputClass} value={o.period_end ?? ""} onChange={(e) => set({ period_end: e.target.value || null })} /></Field>
        </div>
        <Field label="Status" htmlFor="ob-status">
          <select id="ob-status" className={inputClass} value={o.status} onChange={(e) => set({ status: e.target.value as ObjectiveInput["status"] })}>
            <option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option>
          </select>
        </Field>
        {save.isError && <ErrorNote error={save.error} />}
      </div>
    </Dialog>
  );
}

const QUESTIONS = [
  ["must_happen", "What must happen for the business this quarter?", "e.g. sign 3 new operators, fill the Q4 training cohort"],
  ["customers", "Who are the customers you want most?", "role, company type, market"],
  ["key_products", "Which products or services matter most right now?", ""],
  ["path_to_sale", "What's the usual path from first contact to a sale?", "e.g. free assessment → pilot → contract"],
  ["measure", "How will you know it worked?", "e.g. bookings, contracts, enquiries"],
] as const;

function GrowthDraftDialog({ onClose }: { onClose: (drafts?: ObjectiveInput[]) => void }) {
  const ws = useWs();
  const [a, setA] = useState<Record<string, string>>({});
  const draft = useMutation({
    mutationFn: () => api.draftGrowthPlan(ws, { must_happen: a.must_happen ?? "", customers: a.customers ?? "", key_products: a.key_products ?? "", path_to_sale: a.path_to_sale ?? "", measure: a.measure ?? "" }),
    onSuccess: (d) => onClose(d),
  });
  return (
    <Dialog open wide onClose={() => onClose()} title="Draft your growth plan" description="Five short answers. We combine them with what we know about your products and propose 2–4 objectives. Nothing is saved until you keep it."
      footer={<><Button variant="ghost" onClick={() => onClose()}>Cancel</Button><Button variant="primary" loading={draft.isPending} icon={<Sparkles className="size-4" />} onClick={() => draft.mutate()}>Draft objectives</Button></>}>
      {draft.isPending ? <NarratedProgress intervalMs={6000} steps={["Reading your products and facts", "Weighing your answers", "Drafting objectives", "Setting targets and messages"]} /> : (
        <div className="flex flex-col gap-4">
          {QUESTIONS.map(([k, q, hint]) => (
            <Field key={k} label={q} htmlFor={`gq-${k}`} hint={hint || undefined}>
              <textarea id={`gq-${k}`} rows={2} className={textareaClass} value={a[k] ?? ""} onChange={(e) => setA((x) => ({ ...x, [k]: e.target.value }))} />
            </Field>
          ))}
          {draft.isError && <ErrorNote error={draft.error} onRetry={() => draft.mutate()} />}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "–");

function CampaignsTab() {
  const ws = useWs();
  const nav = useNavigate();
  const campaigns = useQuery({ queryKey: ["ws", ws, "campaigns"], queryFn: () => api.campaigns(ws) });
  const [creating, setCreating] = useState(false);
  if (campaigns.isLoading) return <Skeleton className="h-64" />;
  const list = campaigns.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {list.length === 0 ? (
        <EmptyState icon={<CalendarRange className="size-8" />} title="No campaigns yet" action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New campaign</Button>}>
          A campaign is a dated push around specific products, like "Readiness assessment drive, November". Describe it in one sentence and we'll plan the posts: problem first, then proof, then the ask.
        </EmptyState>
      ) : (
        <>
          <div className="flex justify-end"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New campaign</Button></div>
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <li key={c.id}>
                <Link to={`/plan/campaigns/${c.id}`}>
                  <Card className="p-4 transition-colors hover:border-line-strong">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{c.name}</p>
                      <Badge tone={c.status === "active" ? "good" : "neutral"}>{c.status === "draft" ? "Draft" : c.status === "active" ? "Running" : "Done"}</Badge>
                      <Badge>{GOAL_LABEL[c.goal]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{fmtDate(c.start_date)} – {fmtDate(c.end_date)}{c.objective_title ? ` · for "${c.objective_title}"` : ""}</p>
                    <p className="mt-1 text-xs text-ink-3">{c.ideas ?? 0} planned posts · {c.briefs ?? 0} briefs · {c.posts ?? 0} published</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {creating && <NewCampaignDialog onClose={(id) => { setCreating(false); if (id) nav(`/plan/campaigns/${id}`); }} />}
    </div>
  );
}

function blankCampaign(): CampaignInput {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const end = new Date(d);
  end.setDate(end.getDate() + 25);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    name: "", objective_id: null, goal: "leads", product_ids: [], audience: "", key_message: "", offer: "", cta_text: "", cta_url: null,
    start_date: iso(d), end_date: iso(end), platforms: [], posts_per_week: 3, phases: [], success_metric: "", target_value: null, current_value: null,
    knowledge_card_ids: [], status: "draft",
  };
}

function NewCampaignDialog({ onClose }: { onClose: (id?: string) => void }) {
  const ws = useWs();
  const cfg = useAppConfig();
  const [sentence, setSentence] = useState("");
  const [form, setForm] = useState<CampaignInput | null>(null);
  const draft = useMutation({ mutationFn: () => api.draftCampaign(ws, sentence.trim()), onSuccess: (c) => setForm(c) });
  if (form) return <CampaignDialog initial={form} onClose={onClose} />;
  return (
    <Dialog open wide onClose={() => onClose()} title="New campaign"
      description="Describe it in a sentence: what, for whom, and when. We'll fill in the brief from your products and facts; you check it."
      footer={<>
        <Button variant="ghost" onClick={() => setForm(blankCampaign())}>Fill it in myself</Button>
        {cfg.data?.ai_configured && <Button variant="primary" disabled={sentence.trim().length < 5} loading={draft.isPending} icon={<Sparkles className="size-4" />} onClick={() => draft.mutate()}>Draft the campaign</Button>}
      </>}>
      <textarea aria-label="Campaign in one sentence" rows={3} className={textareaClass} value={sentence} onChange={(e) => setSentence(e.target.value)}
        placeholder="e.g. Push our free digital readiness assessment to upstream operators in Nigeria through November" />
      {draft.isError && <div className="mt-3"><ErrorNote error={draft.error} onRetry={() => draft.mutate()} /></div>}
    </Dialog>
  );
}

function CampaignDialog({ initial, id, onClose }: { initial: CampaignInput; id?: string; onClose: (id?: string) => void }) {
  const ws = useWs();
  const summary = useSummary();
  const products = useProducts();
  const objectives = useQuery({ queryKey: ["ws", ws, "objectives"], queryFn: () => api.objectives(ws) });
  const [c, setC] = useState<CampaignInput>(initial);
  const set = (p: Partial<CampaignInput>) => setC((x) => ({ ...x, ...p }));
  const save = useMutation({ mutationFn: () => api.saveCampaign(ws, { ...c, cta_url: c.cta_url || null }, id), onSuccess: (r) => onClose(r.id) });
  const connected = summary.data?.platforms ?? [];
  const platforms: Platform[] = (["linkedin", "instagram", "youtube", "tiktok", "facebook"] as Platform[]);
  return (
    <Dialog open wide onClose={() => onClose()} title={id ? "Edit campaign" : "Check your campaign"}
      footer={<><Button variant="ghost" onClick={() => onClose()}>Cancel</Button><Button variant="primary" disabled={c.name.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>{id ? "Save" : "Save campaign"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="cp-name"><input id="cp-name" className={inputClass} value={c.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Goal" htmlFor="cp-goal">
            <select id="cp-goal" className={inputClass} value={c.goal} onChange={(e) => set({ goal: e.target.value as CampaignInput["goal"], phases: [] })}>
              {CAMPAIGN_GOALS.map((g) => <option key={g} value={g}>{GOAL_LABEL[g]}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Serves objective" htmlFor="cp-obj">
          <select id="cp-obj" className={inputClass} value={c.objective_id ?? ""} onChange={(e) => set({ objective_id: e.target.value || null })}>
            <option value="">None</option>
            {(objectives.data ?? []).map((o: Objective) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
        <div className="flex flex-col gap-1.5"><span className="text-sm font-medium">Products</span><ProductPicker value={c.product_ids} onChange={(v) => set({ product_ids: v })} products={products.data ?? []} /></div>
        <Field label="Audience" htmlFor="cp-aud"><input id="cp-aud" className={inputClass} value={c.audience ?? ""} onChange={(e) => set({ audience: e.target.value })} /></Field>
        <Field label="Key message" htmlFor="cp-msg"><input id="cp-msg" className={inputClass} value={c.key_message ?? ""} onChange={(e) => set({ key_message: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Offer" htmlFor="cp-offer" hint="What they get, if anything"><input id="cp-offer" className={inputClass} value={c.offer ?? ""} onChange={(e) => set({ offer: e.target.value })} /></Field>
          <Field label="Call to action" htmlFor="cp-cta"><input id="cp-cta" className={inputClass} value={c.cta_text ?? ""} onChange={(e) => set({ cta_text: e.target.value })} /></Field>
        </div>
        <Field label="Link" htmlFor="cp-url" hint="Where the call to action points. Briefs add tracking to it."><input id="cp-url" className={inputClass} value={c.cta_url ?? ""} onChange={(e) => set({ cta_url: e.target.value || null })} placeholder="https://" /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts" htmlFor="cp-start"><input id="cp-start" type="date" className={inputClass} value={c.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value || null })} /></Field>
          <Field label="Ends" htmlFor="cp-end"><input id="cp-end" type="date" className={inputClass} value={c.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} /></Field>
          <Field label="Posts a week" htmlFor="cp-ppw"><input id="cp-ppw" type="number" min={1} max={7} className={inputClass} value={c.posts_per_week} onChange={(e) => set({ posts_per_week: Math.max(1, Math.min(7, Number(e.target.value) || 1)) })} /></Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Platforms</span>
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((p) => {
              const on = c.platforms.includes(p);
              return (
                <button key={p} type="button" aria-pressed={on} onClick={() => set({ platforms: on ? c.platforms.filter((x) => x !== p) : [...c.platforms, p] })}
                  className={`rounded-md px-2.5 py-1 text-sm ${on ? "bg-accent-soft text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
                  {PLATFORM_META[p].name}{connected.includes(p) ? "" : " (not connected)"}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Success measure" htmlFor="cp-metric"><input id="cp-metric" className={inputClass} value={c.success_metric ?? ""} onChange={(e) => set({ success_metric: e.target.value })} placeholder="e.g. assessment bookings" /></Field>
          <Field label="Target" htmlFor="cp-target"><input id="cp-target" type="number" className={inputClass} value={c.target_value ?? ""} onChange={(e) => set({ target_value: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
        </div>
        {save.isError && <ErrorNote error={save.error} />}
      </div>
    </Dialog>
  );
}

function CampaignDetail({ id }: { id: string }) {
  const ws = useWs();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = useAppConfig();
  const q = useQuery({ queryKey: ["ws", ws, "campaign", id], queryFn: () => api.campaign(ws, id) });
  const products = useProducts();
  const [editing, setEditing] = useState(false);
  const [briefFor, setBriefFor] = useState<IdeaCard | null>(null);
  const [progress, setProgress] = useState("");
  const plan = useMutation({
    mutationFn: () => api.planCampaign(ws, id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: `${r.created} posts planned. They appear on This week as their dates come up.` }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const setStatus = useMutation({
    mutationFn: (status: Campaign["status"]) => api.saveCampaign(ws, { ...q.data!.campaign, status }, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws] }),
  });
  const updateProgress = useMutation({
    mutationFn: () => api.saveCampaign(ws, { ...q.data!.campaign, current_value: progress === "" ? null : Number(progress) }, id),
    onSuccess: () => { setProgress(""); qc.invalidateQueries({ queryKey: ["ws", ws, "campaign", id] }); },
  });
  const del = useMutation({ mutationFn: () => api.deleteCampaign(ws, id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); nav("/plan/campaigns"); } });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const { campaign: c, ideas, results } = q.data!;
  const pnames = c.product_ids.map((pid) => products.data?.find((p) => p.id === pid)?.name).filter(Boolean).join(", ");
  const phases = [...new Set(ideas.map((i) => i.campaign_phase ?? "Posts"))];
  return (
    <>
      <PageHeader title={c.name} subtitle={<><Link className="underline" to="/plan/campaigns">Campaigns</Link> · {fmtDate(c.start_date)} – {fmtDate(c.end_date)}</>}
        actions={<>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Edit</Button>
          {c.status === "active" ? <Button variant="ghost" onClick={() => setStatus.mutate("done")}>Mark done</Button> : c.status === "done" && <Button variant="ghost" onClick={() => setStatus.mutate("active")}>Reopen</Button>}
          <Button variant="ghost" aria-label="Delete campaign" icon={<Trash2 className="size-4" />} onClick={() => { if (window.confirm("Delete this campaign and its unbriefed posts?")) del.mutate(); }} />
        </>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex flex-col gap-4">
          {plan.isPending ? (
            <Card className="p-6">
              <h2 className="font-semibold">Planning the campaign…</h2>
              <div className="mt-4"><NarratedProgress intervalMs={12000} steps={["Reading the brief and your facts", "Laying out the dates", "Writing the problem posts", "Writing the proof posts", "Writing the ask", "Scoring the sequence"]} /></div>
            </Card>
          ) : ideas.length === 0 ? (
            <EmptyState icon={<Wand2 className="size-8" />} title="Ready to plan"
              action={cfg.data?.ai_configured ? <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => plan.mutate()}>Plan the posts</Button> : undefined}>
              We'll write one post idea per slot ({c.posts_per_week} a week), in order: name the problem, prove the approach, remove hesitations, then ask. Each uses your real facts.
            </EmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{ideas.length} planned posts</h2>
                {cfg.data?.ai_configured && <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" />} onClick={() => { if (window.confirm("Re-plan? Posts not yet briefed are replaced.")) plan.mutate(); }}>Re-plan</Button>}
              </div>
              {phases.map((ph) => (
                <section key={ph}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{ph}</h3>
                  <ul className="flex flex-col gap-2">
                    {ideas.filter((i) => (i.campaign_phase ?? "Posts") === ph).map((i) => <CampaignRow key={i.idea_id} idea={i} onBrief={() => setBriefFor(i)} />)}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
        <aside className="flex flex-col gap-3">
          <Card className="p-4 text-sm">
            <dl className="flex flex-col gap-2">
              <div><dt className="text-ink-3">Goal</dt><dd>{GOAL_LABEL[c.goal]}{c.objective_title ? ` · for "${c.objective_title}"` : ""}</dd></div>
              {pnames && <div><dt className="text-ink-3">Products</dt><dd>{pnames}</dd></div>}
              {c.key_message && <div><dt className="text-ink-3">Key message</dt><dd>{c.key_message}</dd></div>}
              {c.cta_text && <div><dt className="text-ink-3">Call to action</dt><dd>{c.cta_text}{c.cta_url && <> · <a className="underline" href={c.cta_url} target="_blank" rel="noreferrer">link</a></>}</dd></div>}
              <div><dt className="text-ink-3">Platforms</dt><dd className="flex flex-wrap gap-1">{c.platforms.map((p) => <PlatformBadge key={p} platform={p as Platform} />)}</dd></div>
            </dl>
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="font-semibold">Results</h2>
            {results.posts.length === 0 ? <p className="mt-1 text-ink-2">No posts from this campaign published yet. Results appear as they come in.</p> : (
              <div className="mt-2 flex flex-col gap-2">
                <p>{results.posts.length} published · typical post <span className="font-semibold">{multiple(results.median_pi)}</span> your usual · {results.beat_usual} beat your usual</p>
                {results.by_phase.length > 0 && <ul className="text-ink-2">{results.by_phase.map((p) => <li key={p.key}>{p.key}: {multiple(p.median_pi)} ({p.posts})</li>)}</ul>}
              </div>
            )}
            {c.success_metric && (
              <div className="mt-3 border-t border-line pt-3">
                <p><span className="text-ink-3">{c.success_metric}: </span><span className="font-semibold">{c.current_value ?? 0}{c.target_value != null ? ` of ${c.target_value}` : ""}</span></p>
                <div className="mt-2 flex gap-2">
                  <input aria-label="Update progress" type="number" className={`${inputClass} h-8`} placeholder="New total" value={progress} onChange={(e) => setProgress(e.target.value)} />
                  <Button size="sm" disabled={progress === ""} loading={updateProgress.isPending} onClick={() => updateProgress.mutate()}>Update</Button>
                </div>
              </div>
            )}
          </Card>
        </aside>
      </div>
      {editing && <CampaignDialog initial={c} id={id} onClose={() => { setEditing(false); qc.invalidateQueries({ queryKey: ["ws", ws] }); }} />}
      <CreateBriefDialog idea={briefFor} onClose={() => { setBriefFor(null); qc.invalidateQueries({ queryKey: ["ws", ws, "campaign", id] }); }} />
    </>
  );
}

function CampaignRow({ idea, onBrief }: { idea: CampaignIdea; onBrief: () => void }) {
  const stage = idea.features.funnel_stage;
  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="w-20 shrink-0 text-sm">
          <p className="font-semibold">{fmtDate(idea.planned_for)}</p>
          <p className="text-xs text-ink-3">{idea.planned_for ? new Date(`${idea.planned_for}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }) : ""}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadge platform={idea.platform} />
            {stage && <span className="text-xs text-ink-3">{STAGE_TEXT[stage]?.label ?? stage}</span>}
            {idea.grounded && <Badge tone="good">Grounded</Badge>}
          </div>
          <p className="mt-1 font-medium">{idea.title}</p>
          <p className="mt-0.5 text-sm text-ink-2">{idea.core_idea}</p>
        </div>
        <div className="shrink-0">
          {idea.brief_id ? <Link to={`/briefs/${idea.brief_id}`}><Button size="sm" icon={<FileText className="size-4" />}>Open brief</Button></Link>
            : idea.status === "dismissed" ? <span className="text-xs text-ink-3">Removed</span>
            : <Button size="sm" variant="primary" icon={<FileText className="size-4" />} onClick={onBrief}>Create brief</Button>}
        </div>
      </Card>
    </li>
  );
}

