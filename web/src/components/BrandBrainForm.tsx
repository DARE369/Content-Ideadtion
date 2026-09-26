import { Globe, ImageOff, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { GOAL_META, LANGUAGES } from "../lib/format";
import type { BrandBrain, Goal, Offer, RevenueRole, SocialLink, SocialPlatform } from "../lib/types";
import { ChipInput } from "./ChipInput";
import { Button, Field, inputClass, textareaClass } from "./ui";

export function GoalPicker({ value, onChange }: { value: Goal; onChange: (g: Goal) => void }) {
  return (
    <div role="radiogroup" aria-label="Primary goal" className="grid gap-2 sm:grid-cols-2">
      {(Object.keys(GOAL_META) as Goal[]).map((g) => (
        <button
          key={g}
          type="button"
          role="radio"
          aria-checked={value === g}
          onClick={() => onChange(g)}
          className={`rounded-xl border p-3 text-left transition-colors ${value === g ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-surface-2"}`}
        >
          <span className="block text-sm font-semibold">{GOAL_META[g].name}</span>
          <span className="mt-0.5 block text-xs text-ink-2">{GOAL_META[g].blurb}</span>
        </button>
      ))}
    </div>
  );
}

export function LanguageSelect({ id, value, onChange, allowAuto }: { id: string; value: string; onChange: (v: string) => void; allowAuto?: boolean }) {
  const known = value === "" || LANGUAGES.some(([code]) => code === value);
  return (
    <select id={id} className={inputClass} value={known ? value : "__custom"} onChange={(e) => onChange(e.target.value === "__custom" ? value : e.target.value)}>
      {allowAuto && <option value="">Detect from my website</option>}
      {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      {!known && <option value="__custom">{value}</option>}
    </select>
  );
}

const ROLES: { value: RevenueRole; label: string; help: string }[] = [
  { value: "core", label: "Main revenue", help: "Where most of the money comes from" },
  { value: "secondary", label: "Secondary", help: "Sold, but smaller" },
  { value: "lead_magnet", label: "Free / lead magnet", help: "Wins customers for the main lines" },
];

const SOCIAL_NAMES: Record<SocialPlatform, string> = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube",
  x: "X (Twitter)", threads: "Threads", whatsapp: "WhatsApp", other: "Other",
};

function platformFromUrl(url: string): SocialPlatform {
  const h = url.toLowerCase();
  if (/instagram\./.test(h)) return "instagram";
  if (/facebook\.|fb\.com/.test(h)) return "facebook";
  if (/linkedin\./.test(h)) return "linkedin";
  if (/tiktok\./.test(h)) return "tiktok";
  if (/youtube\.|youtu\.be/.test(h)) return "youtube";
  if (/twitter\.com|\/\/(www\.)?x\.com/.test(h)) return "x";
  if (/threads\.net/.test(h)) return "threads";
  if (/wa\.me|whatsapp/.test(h)) return "whatsapp";
  return "other";
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-2">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function LogoPicker({ current, candidates, onChange }: { current?: string; candidates: string[]; onChange: (url: string) => void }) {
  const [broken, setBroken] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const all = [...new Set([...(current ? [current] : []), ...candidates])].filter((u) => !broken.includes(u));
  return (
    <div className="flex flex-col gap-3">
      {all.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-ink-3"><ImageOff className="size-4" aria-hidden />No logo found yet. Paste a link to your logo image below.</div>
      ) : (
        <div role="radiogroup" aria-label="Logo" className="flex flex-wrap gap-3">
          {all.map((u) => (
            <button key={u} type="button" role="radio" aria-checked={current === u} onClick={() => onChange(u)}
              className={`grid size-20 place-items-center overflow-hidden rounded-xl border bg-white p-2 ${current === u ? "border-accent ring-2 ring-accent/40" : "border-line-strong hover:border-ink-3"}`}>
              <img src={u} alt="Logo option" className="max-h-full max-w-full object-contain" onError={() => setBroken((b) => [...b, u])} />
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input aria-label="Logo image link" className={inputClass} placeholder="https://…/logo.png" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <Button type="button" disabled={!/^https?:\/\/\S+\.\S+/.test(custom)} onClick={() => { onChange(custom.trim()); setCustom(""); }}>Use</Button>
      </div>
    </div>
  );
}

function ColorEditor({ colors, onChange }: { colors: string[]; onChange: (c: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-line py-1 pl-1 pr-2 text-xs">
          <input type="color" aria-label={`Colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"}
            className="size-8 cursor-pointer rounded-md border-0 bg-transparent p-0" onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value : x)))} />
          <span className="font-mono">{c}</span>
          <button type="button" aria-label={`Remove ${c}`} className="ml-1 text-ink-3 hover:text-ink" onClick={() => onChange(colors.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      {colors.length < 6 && (
        <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange([...colors, "#888888"])}>Add colour</Button>
      )}
    </div>
  );
}

function SocialEditor({ links, onChange }: { links: SocialLink[]; onChange: (l: SocialLink[]) => void }) {
  const [draft, setDraft] = useState("");
  const valid = /^https?:\/\/\S+\.\S+/.test(draft.trim()) || /^[\w-]+\.[\w.-]+\/\S+/.test(draft.trim());
  const add = () => {
    const url = draft.trim().startsWith("http") ? draft.trim() : `https://${draft.trim()}`;
    onChange([...links, { platform: platformFromUrl(url), url }]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      {links.map((l, i) => (
        <div key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-2">
          <select aria-label="Platform" className={inputClass} value={l.platform}
            onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, platform: e.target.value as SocialPlatform } : x)))}>
            {(Object.keys(SOCIAL_NAMES) as SocialPlatform[]).map((p) => <option key={p} value={p}>{SOCIAL_NAMES[p]}</option>)}
          </select>
          <input aria-label={`${SOCIAL_NAMES[l.platform]} link`} className={`${inputClass} min-w-0`} value={l.url}
            onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
          <Button type="button" variant="ghost" aria-label={`Remove ${l.url}`} icon={<Trash2 className="size-4" />} onClick={() => onChange(links.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="flex gap-2">
        <input aria-label="Add a social profile link" className={inputClass} placeholder="instagram.com/yourbrand" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && valid) { e.preventDefault(); add(); } }} />
        <Button type="button" disabled={!valid} onClick={add} icon={<Plus className="size-4" />}>Add</Button>
      </div>
    </div>
  );
}

function OfferEditor({ offers, onChange }: { offers: Offer[]; onChange: (o: Offer[]) => void }) {
  const set = (i: number, patch: Partial<Offer>) => onChange(offers.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="flex flex-col gap-3">
      {offers.map((o, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <div className="flex gap-2">
            <input aria-label="Product or service" className={`${inputClass} font-medium`} placeholder="Product or service" value={o.name} onChange={(e) => set(i, { name: e.target.value })} />
            <Button type="button" variant="ghost" aria-label={`Remove ${o.name || "item"}`} onClick={() => onChange(offers.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />
          </div>
          <div role="radiogroup" aria-label="How much revenue it brings" className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button key={r.value} type="button" role="radio" aria-checked={o.revenue_role === r.value} title={r.help}
                onClick={() => set(i, { revenue_role: r.value })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${o.revenue_role === r.value ? (r.value === "core" ? "bg-good-soft text-good ring-1 ring-good/40" : "bg-accent-soft text-accent ring-1 ring-accent/40") : "bg-surface-2 text-ink-2 hover:text-ink"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <input aria-label="Short description" className={inputClass} placeholder="What it is, in a few words (optional)" value={o.description ?? ""} onChange={(e) => set(i, { description: e.target.value || undefined })} />
          <div className="grid gap-2 sm:grid-cols-[1fr_1.6fr]">
            <input aria-label="Price" className={inputClass} placeholder="Price (optional)" value={o.price ?? ""} onChange={(e) => set(i, { price: e.target.value || undefined })} />
            <input aria-label="Link" className={inputClass} placeholder="https://… (optional)" value={o.url ?? ""} onChange={(e) => set(i, { url: e.target.value || undefined })} />
          </div>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => onChange([...offers, { name: "", revenue_role: "core" }])}>
        Add a product or service
      </Button>
    </div>
  );
}

/** Editable Brand Brain, shared by setup and settings. */
export function BrandBrainForm({ value, onChange, name, onNameChange, logos = [] }: {
  value: BrandBrain; onChange: (b: BrandBrain) => void; name?: string; onNameChange?: (n: string) => void; logos?: string[];
}) {
  const set = <K extends keyof BrandBrain>(k: K, v: BrandBrain[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-8">
      <Section title="Brand profile">
        {onNameChange && (
          <Field label="Name" htmlFor="bb-name" hint="The name customers know you by.">
            <input id="bb-name" className={inputClass} value={name ?? ""} onChange={(e) => onNameChange(e.target.value)} />
          </Field>
        )}
        <Field label="Website" htmlFor="bb-site">
          <div className="relative">
            <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input id="bb-site" className={`${inputClass} pl-9`} value={value.website_url ?? ""} onChange={(e) => set("website_url", e.target.value || null)} />
          </div>
        </Field>
        <Field label="What you do" htmlFor="bb-desc" hint="One or two sentences on what the business does and who it serves.">
          <textarea id="bb-desc" rows={3} className={textareaClass} value={value.description ?? ""} onChange={(e) => set("description", e.target.value || undefined)} />
        </Field>
        <Field label="Industry" htmlFor="bb-industry">
          <input id="bb-industry" className={inputClass} value={value.industry ?? ""} onChange={(e) => set("industry", e.target.value || undefined)} />
        </Field>
        <Field label="Logo" hint="Used in visual direction for the studio.">
          <LogoPicker current={value.brand_kit.logo_url} candidates={logos} onChange={(u) => set("brand_kit", { ...value.brand_kit, logo_url: u })} />
        </Field>
        <Field label="Colour palette" hint="Taken from your logo and website. Adjust if anything's off.">
          <ColorEditor colors={value.brand_kit.colors} onChange={(c) => set("brand_kit", { ...value.brand_kit, colors: c })} />
        </Field>
        <Field label="Social profiles">
          <SocialEditor links={value.social_links ?? []} onChange={(l) => set("social_links", l)} />
        </Field>
      </Section>

      <Section title="What you sell" hint="Ideas are built to grow your main revenue lines. Mark which products or services bring in most of the money.">
        <OfferEditor offers={value.offers} onChange={(o) => set("offers", o)} />
      </Section>

      <Section title="Audience and voice">
        <Field label="Who you're talking to" htmlFor="bb-audience" hint="Be specific: who they are, where, and what they want from you.">
          <textarea id="bb-audience" rows={3} className={textareaClass} value={value.audience} onChange={(e) => set("audience", e.target.value)} />
        </Field>
        <Field label="What buyers ask before they buy" htmlFor="bb-questions" hint="In their words. Ideas that answer these move people towards buying.">
          <ChipInput id="bb-questions" sentences values={value.buyer_questions ?? []} onChange={(v) => set("buyer_questions", v)} max={15} placeholder="e.g. How long does it take to set up? (press Enter)" />
        </Field>
        <Field label="What makes them hesitate" htmlFor="bb-objections" hint="Price, risk, switching, trust. Decision-stage ideas tackle these head on.">
          <ChipInput id="bb-objections" sentences values={value.objections ?? []} onChange={(v) => set("objections", v)} max={15} placeholder="e.g. Worried about data security (press Enter)" />
        </Field>
        <Field label="Content pillars" htmlFor="bb-pillars" hint="3–5 themes you can post about again and again. Every idea fits one of these.">
          <ChipInput id="bb-pillars" values={value.pillars} onChange={(v) => set("pillars", v)} max={6} placeholder="Add a pillar and press Enter" />
        </Field>
        <Field label="Tone of voice" htmlFor="bb-tone" hint="A few words, e.g. warm, expert, playful.">
          <ChipInput id="bb-tone" values={value.tone_words} onChange={(v) => set("tone_words", v)} max={8} placeholder="Add a word and press Enter" />
        </Field>
        <Field label="Never talk about" htmlFor="bb-banned" hint="Ideas that touch these are dropped automatically.">
          <ChipInput id="bb-banned" values={value.banned_topics} onChange={(v) => set("banned_topics", v)} placeholder="e.g. politics" />
        </Field>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Primary goal" htmlFor="bb-goal">
            <select id="bb-goal" className={inputClass} value={value.goal} onChange={(e) => set("goal", e.target.value as Goal)}>
              {(Object.keys(GOAL_META) as Goal[]).map((g) => <option key={g} value={g}>{GOAL_META[g].name}: {GOAL_META[g].blurb}</option>)}
            </select>
          </Field>
          <Field label="Content language" htmlFor="bb-lang" hint="Hooks, scripts and captions are written in this language and locale.">
            <LanguageSelect id="bb-lang" value={value.language} onChange={(v) => set("language", v)} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

export function brainProblems(b: BrandBrain): string[] {
  const out: string[] = [];
  if (!b.audience.trim()) out.push("Describe your audience.");
  if (b.pillars.length === 0) out.push("Add at least one content pillar.");
  if (!b.language) out.push("Choose a content language.");
  if (b.offers.some((o) => !o.name.trim())) out.push("Give every product or service a name, or remove it.");
  if (b.offers.some((o) => o.url && !/^https?:\/\/\S+\.\S+/.test(o.url))) out.push("Product links must start with http:// or https://.");
  if ((b.social_links ?? []).some((s) => !/^https?:\/\/\S+\.\S+/.test(s.url))) out.push("Social profile links must start with http:// or https://.");
  if (b.website_url && !/^https?:\/\/\S+\.\S+/.test(b.website_url)) out.push("The website must start with http:// or https://.");
  return out;
}

/** Strip empties so the server's validation never trips on UI leftovers. */
export function cleanBrain(b: BrandBrain): BrandBrain {
  const t = (s?: string) => (s?.trim() ? s.trim() : undefined);
  return {
    ...b,
    audience: b.audience.trim(),
    description: t(b.description),
    industry: t(b.industry),
    social_links: (b.social_links ?? []).map((s) => ({ ...s, url: s.url.trim() })).filter((s) => s.url),
    offers: b.offers.filter((o) => o.name.trim()).map((o) => ({
      name: o.name.trim(),
      ...(t(o.url) ? { url: t(o.url) } : {}),
      ...(t(o.price) ? { price: t(o.price) } : {}),
      ...(t(o.description) ? { description: t(o.description) } : {}),
      ...(t(o.category) ? { category: t(o.category) } : {}),
      ...(o.revenue_role ? { revenue_role: o.revenue_role } : {}),
    })),
    brand_kit: { ...b.brand_kit, colors: b.brand_kit.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)), fonts: b.brand_kit.fonts ?? [] },
  };
}
