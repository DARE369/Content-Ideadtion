import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { PlatformBadge } from "../components/bits";
import { BrandBrainForm, brainProblems, cleanBrain } from "../components/BrandBrainForm";
import { CompetitorsEditor } from "../components/CompetitorsEditor";
import { Dialog } from "../components/Dialog";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, ErrorNote, Field, inputClass, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { ALL_PLATFORMS, num, PLATFORM_META, relativeTime } from "../lib/format";
import type { Account, BrandBrain, Platform } from "../lib/types";
import { useSummary, useWorkspace, useWs } from "../lib/workspace";

const TABS = [
  { id: "brand", label: "Brand Brain" },
  { id: "competitors", label: "Competitors" },
  { id: "accounts", label: "Accounts" },
  { id: "usage", label: "AI usage" },
  { id: "workspace", label: "Workspace" },
] as const;

export function SettingsPage() {
  const { tab = "brand" } = useParams();
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Settings" />
      <div role="tablist" aria-label="Settings sections" className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => nav(`/settings/${t.id}`)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === "brand" && <BrandTab />}
        {tab === "competitors" && <Card className="p-5 sm:p-6"><p className="mb-5 text-sm text-ink-2">When a competitor's post does far better than their own usual, it becomes evidence for your ideas. Checked every night, public data only.</p><CompetitorsEditor ws={useWs()} /></Card>}
        {tab === "accounts" && <AccountsTab />}
        {tab === "usage" && <UsageTab />}
        {tab === "workspace" && <WorkspaceTab />}
      </div>
    </>
  );
}

function BrandTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const brain = useQuery({ queryKey: ["ws", ws, "brain"], queryFn: () => api.brain(ws) });
  const [value, setValue] = useState<BrandBrain | null>(null);
  useEffect(() => { if (brain.data && !value) setValue({ ...brain.data, brand_kit: { ...brain.data.brand_kit, colors: brain.data.brand_kit?.colors ?? [], fonts: brain.data.brand_kit?.fonts ?? [] } }); }, [brain.data, value]);
  const save = useMutation({
    mutationFn: (b: BrandBrain) => api.confirmBrain(ws, { ...b, timezone: brain.data?.timezone, trends_geo: brain.data?.trends_geo }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: "Saved. Tonight's ideas will use the changes." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  if (brain.isLoading || !value) return brain.isError ? <ErrorNote error={brain.error} /> : <Skeleton className="h-96" />;
  const problems = brainProblems(value);
  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={(e) => { e.preventDefault(); if (!problems.length) save.mutate(cleanBrain(value)); }}>
        <Field label="Website" htmlFor="bb-site">
          <input id="bb-site" className={inputClass} value={value.website_url ?? ""} onChange={(e) => setValue({ ...value, website_url: e.target.value || null })} />
        </Field>
        <div className="mt-6"><BrandBrainForm value={value} onChange={setValue} /></div>
        {problems.length > 0 && <ul className="mt-6 list-inside list-disc text-sm text-bad">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <div className="sticky bottom-16 mt-6 flex justify-end gap-2 border-t border-line bg-surface pt-4 lg:bottom-0">
          <Button type="button" variant="ghost" onClick={() => setValue(null)}>Discard changes</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={problems.length > 0}>Save</Button>
        </div>
      </form>
    </Card>
  );
}

function AccountsTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useQuery({ queryKey: ["ws", ws, "accounts"], queryFn: () => api.accounts(ws) });
  const [confirm, setConfirm] = useState<Account | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnect(id),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["ws", ws] }); setConfirm(null); toast({ tone: "success", message: `Disconnected. Removed ${r.deleted.posts} posts and their data.` }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 text-sm text-ink-2">
        Your social accounts are connected in your <span className="font-medium text-ink">content studio</span>, which already publishes for you. Once an account is connected there, it appears here and its recent posts are pulled in so you have a baseline from day one.
      </Card>
      {accounts.isLoading ? <Skeleton className="h-32" /> : accounts.data?.length === 0 ? (
        <EmptyState title="No accounts connected yet">Connect Instagram, TikTok, YouTube, Facebook or LinkedIn in your studio.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {accounts.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <PlatformBadge platform={a.platform} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium">{a.handle ?? a.account_kind}</p>
                <p className="text-xs text-ink-3">{a.posts} posts tracked{a.followers != null ? ` · ${num(a.followers)} followers` : ""} · connected {relativeTime(a.connected_at)}</p>
              </div>
              <Button size="sm" variant="ghost" icon={<Unplug className="size-4" />} onClick={() => setConfirm(a)}>Disconnect</Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button className="text-sm text-ink-3 underline-offset-2 hover:text-ink hover:underline" aria-expanded={devOpen} onClick={() => setDevOpen((o) => !o)}>
          {devOpen ? "Hide" : "For developers:"} register an account manually
        </button>
        {devOpen && <DevAccountForm />}
      </div>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={`Disconnect ${confirm ? PLATFORM_META[confirm.platform].name : ""}?`}
        description="This deletes the account's posts, results and comments from this app. It doesn't touch anything on the platform itself."
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" loading={disconnect.isPending} onClick={() => confirm && disconnect.mutate(confirm.id)}>Disconnect and delete data</Button></>}>
        <p className="text-sm text-ink-2">Ideas for this platform will stop using your own results until you reconnect.</p>
      </Dialog>
    </div>
  );
}

function DevAccountForm() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ platform: "instagram" as Platform, external_account_id: "", handle: "", account_kind: "business", studio_connection_id: "" });
  const add = useMutation({
    mutationFn: () => api.addAccount(ws, { ...f, handle: f.handle || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: "Account registered; history backfills on the next job run." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  return (
    <Card className="mt-3 p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Platform" htmlFor="dev-p"><select id="dev-p" className={inputClass} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value as Platform })}>{ALL_PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_META[p].name}</option>)}</select></Field>
        <Field label="Account type" htmlFor="dev-k"><select id="dev-k" className={inputClass} value={f.account_kind} onChange={(e) => setF({ ...f, account_kind: e.target.value })}>{["personal", "business", "creator", "page", "organization", "channel"].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Platform account id" htmlFor="dev-x"><input id="dev-x" className={inputClass} required value={f.external_account_id} onChange={(e) => setF({ ...f, external_account_id: e.target.value })} /></Field>
        <Field label="Handle" htmlFor="dev-h"><input id="dev-h" className={inputClass} value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} /></Field>
        <Field label="Studio connection id" htmlFor="dev-c" hint="What the studio's token endpoint expects."><input id="dev-c" className={inputClass} required value={f.studio_connection_id} onChange={(e) => setF({ ...f, studio_connection_id: e.target.value })} /></Field>
        <div className="flex items-end"><Button type="submit" loading={add.isPending} icon={<Plus className="size-4" />}>Register</Button></div>
      </form>
    </Card>
  );
}

function UsageTab() {
  const ws = useWs();
  const costs = useQuery({ queryKey: ["ws", ws, "costs"], queryFn: () => api.costs(ws) });
  if (costs.isLoading) return <Skeleton className="h-48" />;
  const rows = costs.data ?? [];
  const total = rows.reduce((s, r) => s + r.cost_usd, 0);
  const label = (t: string) => ({ ideator: "Writing ideas", critic: "Editing ideas", "report:weekly": "Weekly reports", "report:autopsy": "Post autopsies", "vision:tag": "Reading competitor thumbnails", "brand_brain:draft": "Brand Brain draft", "refine:verdict": "Refine: verdict", "refine:sharpen": "Refine: sharper versions" } as Record<string, string>)[t] ?? (t.startsWith("adapter:") ? `Brief for ${t.slice(8)}` : t);
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-sm text-ink-2">Claude is the only paid part of this app. Last 30 days:</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">${total.toFixed(2)}</p>
      {rows.length === 0 ? <p className="mt-4 text-sm text-ink-3">No AI usage yet.</p> : (
        <table className="mt-5 w-full text-sm">
          <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">What</th><th className="pb-2 text-right font-medium">Calls</th><th className="pb-2 text-right font-medium">Cost</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => <tr key={r.task + r.model}><td className="py-2">{label(r.task)}<span className="block text-xs text-ink-3">{r.model}</span></td><td className="py-2 text-right tabular-nums">{r.calls}</td><td className="py-2 text-right tabular-nums">${r.cost_usd.toFixed(3)}</td></tr>)}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function WorkspaceTab() {
  const ws = useWs();
  const summary = useSummary();
  const { setWorkspace } = useWorkspace();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (summary.data && !name) setName(summary.data.name); }, [summary.data, name]);
  const rename = useMutation({ mutationFn: () => api.renameWorkspace(ws, name), onSuccess: () => { qc.invalidateQueries(); toast({ tone: "success", message: "Renamed." }); } });
  const remove = useMutation({
    mutationFn: () => api.deleteWorkspace(ws),
    onSuccess: () => { setWorkspace(null); qc.clear(); nav("/welcome"); toast({ tone: "success", message: "Workspace deleted." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
          <div className="flex-1"><Field label="Workspace name" htmlFor="ws-name"><input id="ws-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <Button type="submit" loading={rename.isPending} disabled={!name.trim() || name === summary.data?.name}>Rename</Button>
        </form>
      </Card>
      <Card className="border-bad/30 p-5 sm:p-6">
        <h2 className="text-base font-semibold">Delete this workspace</h2>
        <p className="mt-1 text-sm text-ink-2">Deletes the Brand Brain, ideas, briefs, results and reports. This can't be undone.</p>
        <Button className="mt-4" variant="danger" onClick={() => setConfirmDelete(true)}>Delete workspace</Button>
      </Card>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete workspace?" description={`Type "${summary.data?.name}" to confirm.`}
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={remove.isPending} disabled={typed !== summary.data?.name} onClick={() => remove.mutate()}>Delete forever</Button></>}>
        <input aria-label="Workspace name" className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Dialog>
    </div>
  );
}
