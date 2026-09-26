import { Ban, Clapperboard, Eye, Hash, Image, Megaphone, MessageSquareQuote, Palette, ScrollText } from "lucide-react";
import type { ReactNode } from "react";
import { featureValue, GOAL_META } from "../lib/format";
import type { BriefPayload } from "../lib/types";
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
    </div>
  );
}

/** The brief as a production document: what the studio shoots from. */
export function BriefView({ b, compact }: { b: BriefPayload; compact?: boolean }) {
  return (
    <Card className="p-5 sm:p-6">
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

      {(b.title || b.thumbnail_brief) && (
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

      {b.do_not.length > 0 && !compact && (
        <Section icon={<Ban className="size-4" />} title="Don't">
          <ul className="flex flex-col gap-1 text-sm text-ink-2">{b.do_not.map((d) => <li key={d}>• {d}</li>)}</ul>
        </Section>
      )}
    </Card>
  );
}
