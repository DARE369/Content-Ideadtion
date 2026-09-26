import { Plus, Trash2 } from "lucide-react";
import { GOAL_META, LANGUAGES } from "../lib/format";
import type { BrandBrain, Goal } from "../lib/types";
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

export function LanguageSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const known = LANGUAGES.some(([code]) => code === value);
  return (
    <select id={id} className={inputClass} value={known ? value : "__custom"} onChange={(e) => onChange(e.target.value === "__custom" ? "" : e.target.value)}>
      {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      {!known && <option value="__custom">{value || "Other"}</option>}
    </select>
  );
}

/** Editable Brand Brain, shared by setup and settings. */
export function BrandBrainForm({ value, onChange }: { value: BrandBrain; onChange: (b: BrandBrain) => void }) {
  const set = <K extends keyof BrandBrain>(k: K, v: BrandBrain[K]) => onChange({ ...value, [k]: v });
  const colors = value.brand_kit.colors;
  return (
    <div className="flex flex-col gap-6">
      <Field label="Who you're talking to" htmlFor="bb-audience" hint="Be specific: who they are, where, and what they want from you.">
        <textarea id="bb-audience" rows={3} className={textareaClass} value={value.audience} onChange={(e) => set("audience", e.target.value)} />
      </Field>
      <Field label="Content pillars" htmlFor="bb-pillars" hint="3–5 themes you can post about again and again. Every idea fits one of these.">
        <ChipInput id="bb-pillars" values={value.pillars} onChange={(v) => set("pillars", v)} max={6} placeholder="Add a pillar and press Enter" />
      </Field>
      <Field label="Tone of voice" htmlFor="bb-tone" hint="A few words, e.g. warm, expert, playful.">
        <ChipInput id="bb-tone" values={value.tone_words} onChange={(v) => set("tone_words", v)} max={8} placeholder="Add a word and press Enter" />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">What you sell</legend>
        <p className="-mt-1 mb-1 text-xs text-ink-3">Calls to action link here, tagged so you can see which idea brought the click.</p>
        {value.offers.map((o, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1.4fr_1fr_1.6fr_auto]">
            <input aria-label="Offer name" className={inputClass} placeholder="Name" value={o.name} onChange={(e) => set("offers", value.offers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input aria-label="Price" className={inputClass} placeholder="Price (optional)" value={o.price ?? ""} onChange={(e) => set("offers", value.offers.map((x, j) => (j === i ? { ...x, price: e.target.value || undefined } : x)))} />
            <input aria-label="Link" className={inputClass} placeholder="https://… (optional)" value={o.url ?? ""} onChange={(e) => set("offers", value.offers.map((x, j) => (j === i ? { ...x, url: e.target.value || undefined } : x)))} />
            <Button type="button" variant="ghost" size="md" aria-label={`Remove ${o.name || "offer"}`} onClick={() => set("offers", value.offers.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={() => set("offers", [...value.offers, { name: "" }])}>
          Add an offer
        </Button>
      </fieldset>
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
      <Field label="Brand colours" htmlFor="bb-color-new" hint="Used in visual direction for the studio.">
        <div className="flex flex-wrap items-center gap-2">
          {colors.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-line py-1 pl-1 pr-1.5 text-xs">
              <input type="color" aria-label={`Colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                onChange={(e) => set("brand_kit", { ...value.brand_kit, colors: colors.map((x, j) => (j === i ? e.target.value : x)) })} />
              <span className="font-mono">{c}</span>
              <button type="button" aria-label={`Remove ${c}`} className="text-ink-3 hover:text-ink" onClick={() => set("brand_kit", { ...value.brand_kit, colors: colors.filter((_, j) => j !== i) })}>×</button>
            </span>
          ))}
          {colors.length < 6 && (
            <Button id="bb-color-new" type="button" size="sm" variant="ghost" icon={<Plus className="size-4" />}
              onClick={() => set("brand_kit", { ...value.brand_kit, colors: [...colors, "#c9491c"] })}>Add colour</Button>
          )}
        </div>
      </Field>
    </div>
  );
}

export function brainProblems(b: BrandBrain): string[] {
  const out: string[] = [];
  if (!b.audience.trim()) out.push("Describe your audience.");
  if (b.pillars.length === 0) out.push("Add at least one content pillar.");
  if (!b.language) out.push("Choose a content language.");
  if (b.offers.some((o) => !o.name.trim())) out.push("Give every offer a name, or remove it.");
  if (b.offers.some((o) => o.url && !/^https?:\/\/\S+\.\S+/.test(o.url))) out.push("Offer links must start with http:// or https://.");
  return out;
}

/** Strip empties so the server's validation never trips on UI leftovers. */
export function cleanBrain(b: BrandBrain): BrandBrain {
  return {
    ...b,
    audience: b.audience.trim(),
    offers: b.offers.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), ...(o.url ? { url: o.url.trim() } : {}), ...(o.price ? { price: o.price.trim() } : {}) })),
    brand_kit: { ...b.brand_kit, colors: b.brand_kit.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)), fonts: b.brand_kit.fonts ?? [] },
  };
}
