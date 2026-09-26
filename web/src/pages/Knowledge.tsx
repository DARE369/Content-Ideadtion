import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, CheckCheck, ExternalLink, FileText, FileUp, Globe, Loader2, Merge, Package, Pencil, Plus, Quote, RefreshCw, Trash2, X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Dialog } from "../components/Dialog";
import { ScanPanel } from "../components/ScanPanel";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, inputClass, PageHeader, Skeleton, textareaClass } from "../components/ui";
import { api } from "../lib/api";
import { ACCEPT, uploadAndRead, type UploadStep } from "../lib/files";
import { CARD_TYPES, type CardType, type CoverageRow, type KnowledgeCard, type Product, type RevenueRole } from "../lib/types";
import { useAppConfig, useWs } from "../lib/workspace";

export const CARD_TYPE_LABEL: Record<CardType, string> = {
  product: "Product", service: "Service", feature: "Feature", pricing: "Pricing", proof: "Proof", case_study: "Case study", testimonial: "Testimonial",
  client: "Client", faq: "Buyer question", objection: "Hesitation", claim: "Claim", disclaimer: "Disclaimer", audience: "Audience",
  differentiator: "Differentiator", process: "How it works", event: "Event", news: "News", location: "Location", person: "Person", note: "Note",
};
const ROLE_LABEL: Record<RevenueRole, string> = { core: "Main revenue", secondary: "Secondary", lead_magnet: "Free / lead magnet" };

const TABS = [
  { id: "facts", label: "Facts" },
  { id: "products", label: "Products & services" },
  { id: "sources", label: "Websites" },
  { id: "files", label: "Files" },
  { id: "coverage", label: "Gaps" },
] as const;

export function KnowledgePage() {
  const { tab = "facts", id } = useParams();
  const nav = useNavigate();
  if (tab === "products" && id) return <ProductDetail id={id} />;
  return (
    <>
      <PageHeader title="Knowledge" subtitle="Everything the engine knows about your business, from your websites and files. Every fact links to where it came from; ideas and briefs only use numbers found here." />
      <div role="tablist" aria-label="Knowledge" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => nav(`/knowledge/${t.id}`)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "facts" && <FactsTab />}
      {tab === "products" && <ProductsTab />}
      {tab === "sources" && <SourcesTab />}
      {tab === "files" && <FilesTab />}
      {tab === "coverage" && <CoverageTab />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function useProducts() {
  const ws = useWs();
  return useQuery({ queryKey: ["ws", ws, "products"], queryFn: () => api.products(ws) });
}

function FactsTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<"review" | "approved" | "all">("review");
  const [type, setType] = useState("");
  const [product, setProduct] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const products = useProducts();
  const statusParam = status === "review" ? "suggested,stale" : status === "approved" ? "approved" : "";
  const cards = useQuery({ queryKey: ["ws", ws, "cards", statusParam, type, product, q], queryFn: () => api.cards(ws, { status: statusParam, type, product, q }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ws", ws, "cards"] }); qc.invalidateQueries({ queryKey: ["ws", ws, "products"] }); setPicked(new Set()); };
  const bulk = useMutation({
    mutationFn: (s: "approved" | "rejected") => api.bulkCards(ws, [...picked], s),
    onSuccess: (r, s) => { refresh(); toast({ tone: "success", message: `${r.updated} ${s === "approved" ? "approved" : "removed"}.` }); },
  });
  const merge = useMutation({ mutationFn: () => api.mergeCards(ws, [...picked]), onSuccess: () => { refresh(); toast({ tone: "success", message: "Merged into one fact." }); } });
  const list = cards.data?.cards ?? [];
  const counts = cards.data?.counts ?? {};
  const toReview = (counts.suggested ?? 0) + (counts.stale ?? 0);

  if (!cards.isLoading && !list.length && !q && !type && !product && status === "review" && !counts.approved) {
    return (
      <EmptyState icon={<Globe className="size-8" />} title="No facts yet" action={<Link to="/knowledge/sources"><Button variant="primary">Scan my websites</Button></Link>}>
        Scan your websites or upload a brochure. We'll pull out products, prices, proof, client stories and buyer questions, each with the exact words it came from.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div role="radiogroup" aria-label="Status" className="flex w-fit gap-1 rounded-lg bg-surface-2 p-1 text-sm">
          {([["review", `To review${toReview ? ` (${toReview})` : ""}`], ["approved", `Approved${counts.approved ? ` (${counts.approved})` : ""}`], ["all", "All"]] as const).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={status === v} onClick={() => { setStatus(v); setPicked(new Set()); }}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${status === v ? "bg-surface text-ink shadow-sm" : "text-ink-2"}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_11rem_13rem_auto]">
          <input aria-label="Search facts" className={`${inputClass} col-span-2 md:col-span-1`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Type" className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {CARD_TYPES.map((t) => <option key={t} value={t}>{CARD_TYPE_LABEL[t]}</option>)}
          </select>
          <select aria-label="Product" className={inputClass} value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products</option>
            <option value="none">Company-wide</option>
            {(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button className="col-span-2 md:col-span-1" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a fact</Button>
        </div>
      </div>
      {status === "review" && list.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          <span>Approve what's right, fix what's close, remove what's wrong. Suggested facts are already used in ideas; approved ones rank first.</span>
          <Button size="sm" icon={<CheckCheck className="size-4" />} onClick={() => { setPicked(new Set(list.map((c) => c.id))); }}>Select all {list.length}</Button>
        </div>
      )}
      {cards.isLoading ? <Skeleton className="h-64" /> : cards.isError ? <ErrorNote error={cards.error} onRetry={() => cards.refetch()} /> : !list.length ? (
        <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-2">Nothing here with these filters.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => <FactRow key={c.id} card={c} products={products.data ?? []} checked={picked.has(c.id)}
            onToggle={() => setPicked((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} onChanged={refresh} />)}
        </ul>
      )}
      {picked.size > 0 && (
        <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-primary-ink shadow-lg lg:bottom-4">
          <span className="text-sm">{picked.size} selected</span>
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="accent" loading={bulk.isPending && bulk.variables === "approved"} icon={<Check className="size-4" />} onClick={() => bulk.mutate("approved")}>Approve</Button>
            {picked.size >= 2 && picked.size <= 20 && <Button size="sm" loading={merge.isPending} icon={<Merge className="size-4" />} onClick={() => merge.mutate()}>Merge</Button>}
            <Button size="sm" loading={bulk.isPending && bulk.variables === "rejected"} icon={<Trash2 className="size-4" />} onClick={() => bulk.mutate("rejected")}>Remove</Button>
            <Button size="sm" variant="ghost" className="text-primary-ink" onClick={() => setPicked(new Set())}>Clear</Button>
          </span>
        </div>
      )}
      {adding && <AddFact products={products.data ?? []} onClose={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function FactRow({ card, products, checked, onToggle, onChanged, selectable = true }: { card: KnowledgeCard; products: Product[]; checked: boolean; onToggle: () => void; onChanged: () => void; selectable?: boolean }) {
  const ws = useWs();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [productIds, setProductIds] = useState(card.product_ids);
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.updateCard>[2]) => api.updateCard(ws, card.id, patch),
    onSuccess: () => { setEditing(false); onChanged(); },
  });
  const src = card.sources[0];
  const names = card.product_ids.map((id) => products.find((p) => p.id === id)?.name).filter(Boolean);
  return (
    <li>
      <Card className={`p-4 ${card.status === "stale" ? "border-test/40" : ""}`}>
        <div className="flex gap-3">
          {selectable && <input type="checkbox" aria-label={`Select ${card.title}`} className="mt-1" checked={checked} onChange={onToggle} />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={card.type === "proof" || card.type === "case_study" || card.type === "testimonial" ? "good" : card.type === "objection" || card.type === "disclaimer" ? "test" : "neutral"}>{CARD_TYPE_LABEL[card.type]}</Badge>
              {names.map((n) => <span key={n} className="inline-flex items-center gap-1 text-xs text-ink-2"><Package className="size-3" aria-hidden />{n}</span>)}
              {card.status === "approved" && <Badge tone="good" icon={<Check className="size-3" />}>Approved</Badge>}
              {card.status === "stale" && <Badge tone="test">Page changed: check it</Badge>}
              {card.used_count > 0 && <span className="text-xs text-ink-3">used in {card.used_count} {card.used_count === 1 ? "idea" : "ideas"}</span>}
            </div>
            {editing ? (
              <div className="mt-3 flex flex-col gap-2">
                <input aria-label="Title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
                <textarea aria-label="Fact" rows={3} className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} />
                <select aria-label="Product" className={inputClass} value={productIds[0] ?? ""} onChange={(e) => setProductIds(e.target.value ? [e.target.value] : [])}>
                  <option value="">Company-wide</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ title, body, product_ids: productIds, status: "approved" })}>Save and approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2 font-medium">{card.title}</p>
                {card.body && card.body !== card.title && <p className="mt-0.5 text-sm text-ink-2">{card.body}</p>}
                {Object.keys(card.attributes).length > 0 && (
                  <dl className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(card.attributes).map(([k, v]) => <div key={k} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs"><dt className="inline text-ink-3">{k}: </dt><dd className="inline">{v}</dd></div>)}
                  </dl>
                )}
                {src && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-3">
                    <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>"{src.quote}"{" "}
                      {src.url ? <a className="underline hover:text-ink" href={src.url} target="_blank" rel="noreferrer">{src.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>
                        : src.kind === "upload" ? "from an uploaded file" : src.kind === "user" ? "added by you" : ""}
                      {card.sources.length > 1 && ` · +${card.sources.length - 1} more ${card.sources.length === 2 ? "source" : "sources"}`}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>
          {!editing && (
            <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
              {card.status !== "approved" && <Button size="sm" variant="ghost" aria-label={`Approve ${card.title}`} icon={<Check className="size-4" />} onClick={() => update.mutate({ status: "approved" })} />}
              <Button size="sm" variant="ghost" aria-label={`Edit ${card.title}`} icon={<Pencil className="size-4" />} onClick={() => setEditing(true)} />
              <Button size="sm" variant="ghost" aria-label={`Remove ${card.title}`} icon={<X className="size-4" />} onClick={() => update.mutate({ status: "rejected" })} />
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}

function AddFact({ products, onClose, preset }: { products: Product[]; onClose: () => void; preset?: { type?: CardType; productId?: string; title?: string } }) {
  const ws = useWs();
  const [type, setType] = useState<CardType>(preset?.type ?? "proof");
  const [title, setTitle] = useState(preset?.title ?? "");
  const [body, setBody] = useState("");
  const [productId, setProductId] = useState(preset?.productId ?? "");
  const add = useMutation({ mutationFn: () => api.addCard(ws, { type, title: title.trim(), body: body.trim(), product_ids: productId ? [productId] : [] }), onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} title="Add a fact" description="Things only you know: a result, a client story, a price, what buyers ask. Facts you add are approved straight away."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!title.trim()} loading={add.isPending} onClick={() => add.mutate()}>Add fact</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="af-type">
            <select id="af-type" className={inputClass} value={type} onChange={(e) => setType(e.target.value as CardType)}>
              {CARD_TYPES.map((t) => <option key={t} value={t}>{CARD_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Product or service" htmlFor="af-prod">
            <select id="af-prod" className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Company-wide</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label={type === "faq" ? "The question" : "Short title"} htmlFor="af-title">
          <input id="af-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === "proof" ? "e.g. 18% fewer shutdowns" : ""} />
        </Field>
        <Field label={type === "faq" ? "The answer" : "Details"} htmlFor="af-body">
          <textarea id="af-body" rows={3} className={textareaClass} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {add.isError && <ErrorNote error={add.error} />}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function ProductsTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const nav = useNavigate();
  const products = useProducts();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api.createProduct(ws, { name: name.trim() }),
    onSuccess: (p) => { setName(""); qc.invalidateQueries({ queryKey: ["ws", ws, "products"] }); nav(`/knowledge/products/${p.id}`); },
  });
  const keep = useMutation({ mutationFn: (id: string) => api.updateProduct(ws, id, { confirmed: true }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws] }) });
  const remove = useMutation({ mutationFn: (id: string) => api.removeProduct(ws, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws] }) });
  if (products.isLoading) return <Skeleton className="h-64" />;
  const list = products.data ?? [];
  const suggested = list.filter((p) => !p.confirmed);
  const confirmed = list.filter((p) => p.confirmed);
  return (
    <div className="flex flex-col gap-6">
      {suggested.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Found on your sites: are these yours to sell?</h2>
          <ul className="flex flex-col gap-2">
            {suggested.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name} <span className="text-xs font-normal text-ink-3">{p.kind} · {p.cards ?? 0} facts{p.source_domain ? ` · ${p.source_domain}` : ""}</span></p>
                    {(p.summary || p.ai_summary) && <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{p.summary || p.ai_summary}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={() => keep.mutate(p.id)}>Keep</Button>
                    <Button size="sm" variant="ghost" onClick={() => nav(`/knowledge/products/${p.id}`)}>Open</Button>
                    <Button size="sm" variant="ghost" aria-label={`Not ours: ${p.name}`} icon={<X className="size-4" />} onClick={() => remove.mutate(p.id)} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="mb-2 text-sm font-semibold">What you sell</h2>
        {confirmed.length === 0 ? <p className="text-sm text-ink-2">No products yet. Add one below or scan your websites.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {confirmed.map((p) => (
              <li key={p.id}>
                <Link to={`/knowledge/products/${p.id}`} className="block h-full">
                  <Card className="h-full p-4 transition-colors hover:border-line-strong">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{p.name}</p>
                      {p.revenue_role && <Badge tone={p.revenue_role === "core" ? "good" : "neutral"}>{ROLE_LABEL[p.revenue_role]}</Badge>}
                      {p.status !== "active" && <Badge tone="test">{p.status}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm text-ink-2">{p.summary || p.ai_summary || "No description yet."}</p>
                    <p className="mt-2 text-xs text-ink-3">{p.cards ?? 0} facts{p.price_text ? ` · ${p.price_text}` : ""}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex gap-2">
        <input aria-label="New product or service" className={inputClass} placeholder="Add a product or service" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); }} />
        <Button icon={<Plus className="size-4" />} disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>Add</Button>
      </div>
    </div>
  );
}

function ProductDetail({ id }: { id: string }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const cfg = useAppConfig();
  const q = useQuery({ queryKey: ["ws", ws, "product", id], queryFn: () => api.product(ws, id) });
  const products = useProducts();
  const [form, setForm] = useState<Partial<Product> | null>(null);
  const [adding, setAdding] = useState<{ type: CardType; title?: string } | null>(null);
  const p = q.data?.product;
  const f = form ?? p ?? null;
  const save = useMutation({
    mutationFn: () => api.updateProduct(ws, id, {
      name: f!.name, kind: f!.kind, revenue_role: f!.revenue_role ?? null, status: f!.status, confirmed: true, summary: f!.summary || null,
      audience: f!.audience || null, price_text: f!.price_text || null, url: f!.url || null,
    }),
    onSuccess: () => { setForm(null); qc.invalidateQueries({ queryKey: ["ws", ws] }); toast({ tone: "success", message: "Saved. Ideas and briefs use this from now on." }); },
    onError: (e) => toast({ tone: "error", message: e.message }),
  });
  const summaries = useMutation({ mutationFn: () => api.refreshSummaries(ws), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws, "product", id] }) });
  const remove = useMutation({ mutationFn: () => api.removeProduct(ws, id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["ws", ws] }); nav("/knowledge/products"); } });
  const cov = useQuery({ queryKey: ["ws", ws, "coverage"], queryFn: () => api.coverage(ws) });
  const groups = useGroups(q.data?.cards ?? EMPTY_CARDS);
  if (q.isLoading || !f) return q.isError ? <ErrorNote error={q.error} /> : <Skeleton className="h-96" />;
  const set = (patch: Partial<Product>) => setForm({ ...f, ...patch });
  const gaps = cov.data?.find((c) => c.product_id === id)?.items.filter((i) => i.question) ?? [];
  return (
    <>
      <PageHeader title={p!.name} subtitle={<Link to="/knowledge/products" className="underline">All products</Link>}
        actions={<Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => { if (window.confirm(p!.confirmed ? "Retire this product? Its facts are kept." : "Remove this suggestion?")) remove.mutate(); }}>{p!.confirmed ? "Retire" : "Remove"}</Button>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4 p-5">
            {!p!.confirmed && <p className="rounded-lg bg-test-soft px-3 py-2 text-sm text-test">Found on your website. Save to confirm you sell this; until then ideas don't promote it.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="pd-name"><input id="pd-name" className={inputClass} value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Revenue role" htmlFor="pd-role">
                <select id="pd-role" className={inputClass} value={f.revenue_role ?? ""} onChange={(e) => set({ revenue_role: (e.target.value || null) as RevenueRole | null })}>
                  <option value="">Not set</option>
                  {(Object.keys(ROLE_LABEL) as RevenueRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </Field>
              <Field label="Type" htmlFor="pd-kind">
                <select id="pd-kind" className={inputClass} value={f.kind ?? "product"} onChange={(e) => set({ kind: e.target.value as Product["kind"] })}>
                  <option value="product">Product</option><option value="service">Service</option>
                </select>
              </Field>
              <Field label="Status" htmlFor="pd-status">
                <select id="pd-status" className={inputClass} value={f.status ?? "active"} onChange={(e) => set({ status: e.target.value as Product["status"] })}>
                  <option value="active">Active</option><option value="launching">Launching soon</option><option value="seasonal">Seasonal</option><option value="retired">Retired</option>
                </select>
              </Field>
              <Field label="Price" htmlFor="pd-price" hint='Even rough: "from ₦45,000", "on request"'><input id="pd-price" className={inputClass} value={f.price_text ?? ""} onChange={(e) => set({ price_text: e.target.value })} /></Field>
              <Field label="Page link" htmlFor="pd-url" hint="Briefs link here"><input id="pd-url" className={inputClass} value={f.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://" /></Field>
            </div>
            <Field label="Who it's for" htmlFor="pd-aud"><input id="pd-aud" className={inputClass} value={f.audience ?? ""} onChange={(e) => set({ audience: e.target.value })} /></Field>
            <Field label="Description" htmlFor="pd-sum" hint={p!.ai_summary && !f.summary ? "Empty = use the AI summary below" : undefined}>
              <textarea id="pd-sum" rows={3} className={textareaClass} value={f.summary ?? ""} onChange={(e) => set({ summary: e.target.value })} />
            </Field>
            {p!.ai_summary && (
              <div className="rounded-lg bg-surface-2 p-3 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">AI summary from your facts</p>
                <p className="mt-1 text-ink-2">{p!.ai_summary}</p>
                {p!.benefits.length > 0 && <ul className="mt-2 list-inside list-disc text-ink-2">{p!.benefits.map((b) => <li key={b}>{b}</li>)}</ul>}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{p!.confirmed ? "Save" : "Save and confirm"}</Button>
              {cfg.data?.ai_configured && q.data!.cards.length >= 2 && <Button variant="ghost" loading={summaries.isPending} icon={<RefreshCw className="size-4" />} onClick={() => summaries.mutate()}>Refresh summary</Button>}
            </div>
          </Card>
          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Facts ({q.data!.cards.length})</h2><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding({ type: "proof" })}>Add a fact</Button></div>
            {groups.length === 0 ? <p className="text-sm text-ink-2">No facts linked yet.</p> : groups.map(([type, cards]) => (
              <div key={type} className="mb-4">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{CARD_TYPE_LABEL[type]}</h3>
                <ul className="flex flex-col gap-2">
                  {cards.map((c) => <FactRow key={c.id} selectable={false} card={c} products={products.data ?? []} checked={false} onToggle={() => undefined} onChanged={() => qc.invalidateQueries({ queryKey: ["ws", ws] })} />)}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <aside className="flex flex-col gap-3">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">What's missing</h2>
            {gaps.length === 0 ? <p className="mt-1 text-sm text-good">Well covered. Ideas for this product can be specific.</p> : (
              <ul className="mt-2 flex flex-col gap-3">
                {gaps.map((g) => (
                  <li key={g.key} className="text-sm">
                    <p className="text-ink-2">{g.question}</p>
                    <Button size="sm" variant="ghost" className="mt-1 -ml-2" icon={<Plus className="size-4" />}
                      onClick={() => setAdding({ type: ({ description: "feature", pricing: "pricing", proof: "proof", faq: "faq", objection: "objection", audience: "audience" } as Record<string, CardType>)[g.key] ?? "note" })}>Answer</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
      {adding && <AddFact products={products.data ?? []} preset={{ type: adding.type, productId: id }} onClose={() => { setAdding(null); qc.invalidateQueries({ queryKey: ["ws", ws] }); }} />}
    </>
  );
}

const EMPTY_CARDS: KnowledgeCard[] = [];

function useGroups(cards: KnowledgeCard[]): [CardType, KnowledgeCard[]][] {
  return useMemo(() => {
    const m = new Map<CardType, KnowledgeCard[]>();
    for (const c of cards) m.set(c.type, [...(m.get(c.type) ?? []), c]);
    return [...m.entries()].sort((a, b) => CARD_TYPES.indexOf(a[0]) - CARD_TYPES.indexOf(b[0]));
  }, [cards]);
}

// ---------------------------------------------------------------------------
// Websites (sources + scans)
// ---------------------------------------------------------------------------

function SourcesTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ["ws", ws, "sources"], queryFn: () => api.sources(ws) });
  const set = useMutation({ mutationFn: ({ id, status }: { id: string; status: "active" | "rejected" }) => api.setSource(ws, id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws, "sources"] }) });
  const ROLE: Record<string, string> = { primary: "Main website", product_site: "Product site", shop: "Shop", sister_brand: "Sister brand", link_in_bio: "Link in bio", other: "Other site" };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="p-5"><ScanPanel /></Card>
      <aside>
        <h2 className="mb-2 text-sm font-semibold">Your sites</h2>
        {sources.isLoading ? <Skeleton className="h-24" /> : (
          <ul className="flex flex-col gap-2">
            {(sources.data ?? []).filter((s) => s.status !== "rejected").map((s) => (
              <li key={s.id}>
                <Card className="p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium"><Globe className="size-4 text-ink-3" aria-hidden />{s.domain}</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {ROLE[s.role] ?? s.role}{s.added_by === "auto" ? " · found automatically" : ""}{s.last_scanned_at ? ` · scanned ${new Date(s.last_scanned_at).toLocaleDateString()}` : " · not scanned yet"}
                  </p>
                  {s.relation_reasons.length > 0 && <p className="mt-1 text-xs text-ink-2">Why: {s.relation_reasons.join(", ")}</p>}
                  {s.status === "pending_confirm" ? (
                    <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => set.mutate({ id: s.id, status: "active" })}>It's ours</Button><Button size="sm" variant="ghost" onClick={() => set.mutate({ id: s.id, status: "rejected" })}>Not ours</Button></div>
                  ) : s.role !== "primary" && (
                    <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => set.mutate({ id: s.id, status: "rejected" })}>Stop scanning</Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const STEP_TEXT: Record<UploadStep, string> = { fingerprint: "Checking…", upload: "Uploading…", read: "Reading…", done: "Done" };

function FilesTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const cfg = useAppConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; step: UploadStep }[]>([]);
  const uploads = useQuery({ queryKey: ["ws", ws, "uploads"], queryFn: () => api.uploads(ws) });
  const del = useMutation({ mutationFn: (id: string) => api.deleteUpload(ws, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws", ws, "uploads"] }) });
  const open = async (id: string) => {
    const url = await api.uploadLink(ws, id).catch(() => null);
    if (url) window.open(url, "_blank", "noopener"); else toast({ tone: "info", message: "The original isn't stored (file storage isn't set up)." });
  };
  const handle = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of [...files]) {
      setBusy((b) => [...b, { name: file.name, step: "fingerprint" }]);
      try {
        const r = await uploadAndRead(ws, file, (step) => setBusy((b) => b.map((x) => (x.name === file.name ? { ...x, step } : x))));
        toast({ tone: "success", message: r.existing ? `${file.name} was already read; nothing new to pay for.` : `${file.name}: ${r.upload.cards_added} new facts to review.` });
      } catch (e) {
        toast({ tone: "error", message: `${file.name}: ${(e as Error).message}` });
      } finally {
        setBusy((b) => b.filter((x) => x.name !== file.name));
        qc.invalidateQueries({ queryKey: ["ws", ws] });
      }
    }
    if (input.current) input.current.value = "";
  };
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Brochures, price lists, decks, screenshots</h2>
            <p className="mt-1 text-sm text-ink-2">PDF, PNG, JPG, WebP or text, up to 50 MB. For Word or PowerPoint, save as PDF first. The same file is never read (or paid for) twice.</p>
            {uploads.data && !uploads.data.storage && <p className="mt-2 text-xs text-test">File storage isn't set up, so originals aren't kept (the facts are). Scanned PDFs need storage: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.</p>}
          </div>
          <Button variant="primary" icon={<FileUp className="size-4" />} disabled={!cfg.data?.ai_configured} onClick={() => input.current?.click()}>Upload files</Button>
          <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Upload files" onChange={(e) => handle(e.target.files)} />
        </div>
        {busy.length > 0 && (
          <ul className="mt-4 flex flex-col gap-1 text-sm" aria-live="polite">
            {busy.map((b) => <li key={b.name} className="flex items-center gap-2"><Loader2 className="size-4 animate-spin text-accent" aria-hidden />{b.name} · {STEP_TEXT[b.step]}</li>)}
          </ul>
        )}
      </Card>
      {uploads.isLoading ? <Skeleton className="h-24" /> : (uploads.data?.uploads ?? []).length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {uploads.data!.uploads.map((u) => (
            <li key={u.id}>
              <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium"><FileText className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{u.filename}</span></p>
                  <p className="text-xs text-ink-3">
                    {(u.size_bytes / 1024 / 1024).toFixed(1)} MB{u.pages ? ` · ${u.pages} pages` : ""} · {u.status === "processed" ? `${u.cards_added} facts` : u.status === "failed" ? <span className="text-bad">{u.error}</span> : "not read yet"}
                  </p>
                </div>
                <div className="flex gap-1">
                  {u.storage_path && <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => open(u.id)}>Open</Button>}
                  <Button size="sm" variant="ghost" aria-label={`Delete ${u.filename}`} icon={<Trash2 className="size-4" />} onClick={() => { if (window.confirm("Delete this file? Facts learned from it are kept.")) del.mutate(u.id); }} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gaps (coverage) and whether grounding pays off
// ---------------------------------------------------------------------------

function CoverageTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const cov = useQuery({ queryKey: ["ws", ws, "coverage"], queryFn: () => api.coverage(ws) });
  const acc = useQuery({ queryKey: ["ws", ws, "acceptance"], queryFn: () => api.acceptance(ws) });
  const products = useProducts();
  const [adding, setAdding] = useState<{ type: CardType; productId: string } | null>(null);
  const pct = (r: number | null) => (r == null ? "–" : `${Math.round(r * 100)}%`);
  if (cov.isLoading) return <Skeleton className="h-64" />;
  const rows: CoverageRow[] = cov.data ?? [];
  const TYPE_FOR: Record<string, CardType> = { description: "feature", pricing: "pricing", proof: "proof", faq: "faq", objection: "objection", audience: "audience" };
  return (
    <div className="flex flex-col gap-6">
      {acc.data && (acc.data.grounded.accepted + acc.data.grounded.dismissed + acc.data.starter.accepted + acc.data.starter.dismissed) > 0 && (
        <Card className="p-4 text-sm">
          <p className="font-medium">Do facts make better ideas?</p>
          <p className="mt-1 text-ink-2">Ideas built on your facts and evidence were picked <span className="font-semibold text-ink">{pct(acc.data.grounded.rate)}</span> of the time, versus <span className="font-semibold text-ink">{pct(acc.data.starter.rate)}</span> for ideas from your Brand Brain alone.</p>
        </Card>
      )}
      {rows.length === 0 ? <EmptyState title="No products yet">Add your products or scan your websites to see what's missing.</EmptyState> : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.product_id}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/knowledge/products/${r.product_id}`} className="font-semibold hover:underline">{r.product}{!r.confirmed && <span className="ml-2 text-xs font-normal text-test">suggested</span>}</Link>
                  <span className="text-xs text-ink-3">{Math.round(r.score * 100)}% covered</span>
                </div>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {r.items.map((i) => (
                    <li key={i.key} className="flex items-start gap-2 text-sm">
                      {i.count ? <Check className="mt-0.5 size-4 shrink-0 text-good" aria-label="Covered" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-test" aria-label="Missing" />}
                      <span className="min-w-0">
                        <span className={i.count ? "" : "font-medium"}>{i.label}</span>{i.count > 0 && <span className="text-ink-3"> · {i.count}</span>}
                        {i.question && <button className="block text-left text-xs text-accent hover:underline" onClick={() => setAdding({ type: TYPE_FOR[i.key] ?? "note", productId: r.product_id })}>{i.question}</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddFact products={products.data ?? []} preset={{ type: adding.type, productId: adding.productId }} onClose={() => { setAdding(null); qc.invalidateQueries({ queryKey: ["ws", ws] }); }} />}
      <p className="text-xs text-ink-3">What each scan and upload cost is in Settings → AI spend.</p>
    </div>
  );
}
