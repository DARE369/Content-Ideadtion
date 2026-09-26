import { AlertTriangle, Ban, Building2, Clapperboard, Eye, Hash, Image, Megaphone, MessageSquareQuote, Palette, ScrollText, Search } from "lucide-react";
import type { ReactNode } from "react";
import { featureValue, GOAL_META } from "../lib/format";
import type { BriefPayload, Optimization } from "../lib/types";
import { STAGE_TEXT } from "../lib/format";
import { CopyButton, LabelBadge, PlatformBadge } from "./bits";
import { Badge, Card } from "./ui";

function Section({ icon, title, copy, children }: { icon: ReactNode; title: string; copy?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-ink-3" aria-hidden>{icon}</span>
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {copy && <CopyButton text={copy} />}
      </div>
      {children}
    </section>
  );
}

export function briefToText(b: BriefPayload): string {
  return [
    b.core_idea, "",
    "HOOKS", ...b.hooks.map((h, i) => `${i + 1}. ${h}`), "",
    ...(b.structure?.length ? ["STRUCTURE", ...b.structure.map((s) => `${s.t} — ${s.beat}${s.on_screen_text ? ` | on screen: ${s.on_screen_text}` : ""}`), ""] : []),
    ...(b.script_or_copy ? ["SCRIPT", b.script_or_copy, ""] : []),
    "CAPTION", b.caption, "",
    `CTA: ${b.cta.text ?? b.cta.type}${b.cta.url ? ` ${b.cta.url}` : ""}`,
  ].join("\n");
}

export function BriefMeta({ b }: { b: BriefPayload }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PlatformBadge platform={b.platform ?? null} />
      {b.format && <Badge>{featureValue("format", b.format)}</Badge>}
      {b.aspect_ratio && <Badge>{b.aspect_ratio}</Badge>}
      {b.length_seconds && <Badge>{b.length_seconds[0]}–{b.length_seconds[1]}s</Badge>}
      <Badge>{b.language}</Badge>
      <Badge>Goal: {GOAL_META[b.goal].name}</Badge>
      <LabelBadge label={b.label} />
      {b.product && <Badge tone="good">Sells {b.product.name}</Badge>}
      {b.buyer_stage && <Badge>{STAGE_TEXT[b.buyer_stage]?.label ?? b.buyer_stage} stage</Badge>}
      {b.campaign && <Badge tone="accent">{b.campaign.name}{b.campaign.phase ? ` · ${b.campaign.phase}` : ""}</Badge>}
    </div>
  );
}

/** The brief as a production document: what the studio shoots from. */
export function BriefView({ b, compact }: { b: BriefPayload; compact?: boolean }) {
  return (
    <Card className="p-5 sm:p-6">
      {b.review_notes && b.review_notes.length > 0 && (
        <div role="note" className="mb-5 flex gap-2 rounded-lg bg-test-soft px-3 py-2 text-sm text-test">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div><p className="font-medium">Check before publishing</p><ul className="mt-1 list-inside list-disc">{b.review_notes.map((n) => <li key={n}>{n}</li>)}</ul></div>
        </div>
      )}
      <Section icon={<MessageSquareQuote className="size-4" />} title="Hooks: pick one" copy={b.hooks.join("\n")}>
        <ol className="flex flex-col gap-2">
          {b.hooks.map((h, i) => (
            <li key={i} className="group flex items-start gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold text-ink-2">{i + 1}</span>
              <span className="flex-1 text-sm font-medium">{h}</span>
              <CopyButton text={h} label="Copy" className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100" />
            </li>
          ))}
        </ol>
      </Section>

      {b.messaging?.length ? (
        <Section icon={<Megaphone className="size-4" />} title="Key messages">
          <ol className="list-inside list-decimal space-y-1 text-sm">{b.messaging.map((m) => <li key={m}>{m}</li>)}</ol>
        </Section>
      ) : null}

      {b.structure?.length ? (
        <Section icon={<Clapperboard className="size-4" />} title="Beat by beat">
          <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
            {b.structure.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.6rem] top-1 size-2.5 rounded-full border-2 border-surface bg-accent" aria-hidden />
                <p className="text-xs font-semibold tabular-nums text-ink-3">{s.t}</p>
                <p className="text-sm font-medium">{s.beat}</p>
                {s.on_screen_text && <p className="mt-1 text-sm"><span className="text-ink-3">On screen: </span>"{s.on_screen_text}"</p>}
                {s.voiceover && !compact && <p className="mt-0.5 text-sm text-ink-2"><span className="text-ink-3">Voice: </span>{s.voiceover}</p>}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {b.script_or_copy && !compact && (
        <Section icon={<ScrollText className="size-4" />} title={b.format === "text_post" || b.format === "document_carousel" ? "Copy" : "Script"} copy={b.script_or_copy}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{b.script_or_copy}</p>
        </Section>
      )}

      {b.optimization && <OptimizationSection o={b.optimization} platform={b.platform ?? null} />}

      {(b.title || b.thumbnail_brief) && !b.optimization?.titles?.length && (
        <Section icon={<Image className="size-4" />} title="Title and thumbnail" copy={b.title}>
          {b.title && <p className="text-sm font-semibold">{b.title}</p>}
          {b.thumbnail_brief && <p className="mt-1 text-sm text-ink-2">{b.thumbnail_brief}</p>}
        </Section>
      )}

      <Section icon={<Hash className="size-4" />} title="Caption and call to action" copy={b.caption}>
        <p className="whitespace-pre-wrap text-sm">{b.caption}</p>
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="font-medium">{b.cta.text ?? featureValue("cta_type", b.cta.type)}</span>
          {b.cta.url && (
            <p className="mt-1 break-all text-xs text-ink-3" title="Tagged with this brief's id so clicks trace back to the idea">
              {b.cta.url}
            </p>
          )}
        </div>
        {b.suggested_formats?.length ? <p className="mt-3 text-sm text-ink-2">Works as: {b.suggested_formats.map((f) => featureValue("format", f)).join(", ")}</p> : null}
      </Section>

      <Section icon={<Palette className="size-4" />} title="Visual direction">
        <p className="text-sm">{b.visual_direction.style}</p>
        {b.visual_direction.brand_colors.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Brand colours">
            {b.visual_direction.brand_colors.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <span className="size-4 rounded border border-line" style={{ background: c }} aria-hidden />{c}
              </li>
            ))}
          </ul>
        )}
        {b.visual_direction.shots.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-2">
            {b.visual_direction.shots.map((s) => <li key={s} className="flex gap-2"><Eye className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />{s}</li>)}
          </ul>
        )}
      </Section>

      {b.facts && b.facts.length > 0 && !compact && (
        <Section icon={<Building2 className="size-4" />} title="Facts this brief can use">
          <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
            {b.facts.map((f) => <li key={f.id}>• {f.text}{f.url && <> <a className="text-xs underline" href={f.url} target="_blank" rel="noreferrer">source</a></>}</li>)}
          </ul>
        </Section>
      )}
      {b.do_not.length > 0 && !compact && (
        <Section icon={<Ban className="size-4" />} title="Don't">
          <ul className="flex flex-col gap-1 text-sm text-ink-2">{b.do_not.map((d) => <li key={d}>• {d}</li>)}</ul>
        </Section>
      )}
    </Card>
  );
}

function OptimizationSection({ o, platform }: { o: Optimization; platform: string | null }) {
  const yt = platform === "youtube";
  const kc = o.keyword_check;
  return (
    <Section icon={<Search className="size-4" />} title={yt ? "Search, titles and thumbnails" : "Search and discovery"} copy={[o.primary_keyword, ...o.secondary_keywords].join(", ")}>
      <div className="flex flex-col gap-4 text-sm">
        <p><span className="text-ink-3">Keyword: </span><span className="font-semibold">{o.primary_keyword}</span>{o.secondary_keywords.length > 0 && <span className="text-ink-2"> · also {o.secondary_keywords.join(", ")}</span>}</p>
        {kc && (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="font-medium">What already ranks on YouTube{kc.region ? ` (${kc.region})` : ""}</p>
            <p className="mt-1 text-ink-2">{kc.suggested_angle}</p>
            {kc.top_results.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
                {kc.top_results.slice(0, 5).map((r) => <li key={r.url}><a className="underline" href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.channel}{r.views != null ? ` · ${r.views.toLocaleString()} views` : ""}</li>)}
              </ul>
            )}
          </div>
        )}
        {yt && o.titles && o.titles.length > 0 && (
          <div>
            <p className="mb-1 font-medium">3 titles to test <span className="font-normal text-ink-3">(YouTube Studio → Test &amp; Compare)</span></p>
            <ol className="flex list-inside list-decimal flex-col gap-1">{o.titles.map((t) => <li key={t} className="flex items-center justify-between gap-2"><span>{t}</span><CopyButton text={t} label="Copy" /></li>)}</ol>
          </div>
        )}
        {yt && o.thumbnails && o.thumbnails.length > 0 && (
          <div>
            <p className="mb-1 font-medium">Thumbnail concepts{o.thumbnail_spec ? <span className="font-normal text-ink-3"> · {o.thumbnail_spec.size}, {o.thumbnail_spec.ratio}, up to {o.thumbnail_spec.max_mb} MB</span> : ""}</p>
            <ul className="grid gap-2 sm:grid-cols-3">
              {o.thumbnails.map((t, i) => (
                <li key={i} className="rounded-lg border border-line p-3">
                  <div className="mb-2 grid aspect-video place-items-center rounded-md px-2 text-center text-sm font-bold" style={{ background: t.colors[0] ?? "#222", color: t.colors[1] && t.colors[1] !== t.colors[0] ? t.colors[1] : "#fff" }}>{t.text}</div>
                  <p className="text-xs"><span className="font-medium">{t.subject}</span> · {t.layout}</p>
                  <p className="mt-1 text-xs text-ink-2">{t.concept}</p>
                </li>
              ))}
            </ul>
            {o.thumbnail_spec && <p className="mt-1 text-xs text-ink-3">{o.thumbnail_spec.safe_zone}</p>}
          </div>
        )}
        {yt && o.description && (
          <div><div className="mb-1 flex items-center justify-between"><p className="font-medium">Description</p><CopyButton text={[o.description, "", ...(o.chapters ?? []).map((c) => `${c.t} ${c.title}`)].join("\n")} /></div>
            <p className="whitespace-pre-wrap text-ink-2">{o.description}</p></div>
        )}
        {yt && o.chapters && o.chapters.length > 0 && (
          <div><p className="mb-1 font-medium">Chapters</p><ul className="font-mono text-xs text-ink-2">{o.chapters.map((c) => <li key={c.t}>{c.t} {c.title}</li>)}</ul></div>
        )}
        {!yt && o.caption_first_line && <p><span className="text-ink-3">Caption opens with: </span>{o.caption_first_line}</p>}
        {o.on_screen_text && o.on_screen_text.length > 0 && <p><span className="text-ink-3">On-screen text: </span>{o.on_screen_text.join(" · ")}</p>}
        {o.spoken_keyword_line && <p><span className="text-ink-3">Say out loud: </span>"{o.spoken_keyword_line}"</p>}
        {o.alt_text && <p><span className="text-ink-3">Alt text: </span>{o.alt_text}</p>}
        {o.hashtags.length > 0 && <p><span className="text-ink-3">Hashtags: </span>{o.hashtags.join(" ")}</p>}
        {yt && o.tags && o.tags.length > 0 && <p className="text-xs text-ink-3">Tags (misspellings only; YouTube says tags play a minimal role): {o.tags.join(", ")}</p>}
      </div>
    </Section>
  );
}
