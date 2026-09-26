import clsx from "clsx";
import { BadgeCheck, Check, Copy, FlaskConical } from "lucide-react";
import { useState } from "react";
import { PLATFORM_META } from "../lib/format";
import type { Platform } from "../lib/types";
import { Badge } from "./ui";

export function PlatformBadge({ platform, withName = true, size = "md" }: { platform: Platform | null; withName?: boolean; size?: "sm" | "md" }) {
  if (!platform) return <Badge>All platforms</Badge>;
  const m = PLATFORM_META[platform];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-xs font-medium text-ink-2", size === "sm" && "text-[11px]")}>
      <span className={clsx("inline-grid place-items-center rounded-md font-bold", size === "sm" ? "size-5 text-[9px]" : "size-6 text-[10px]", m.className)} aria-hidden>
        {m.short}
      </span>
      {withName ? m.name : <span className="sr-only">{m.name}</span>}
    </span>
  );
}

/** Proven = reuses a pattern that beat this brand's baseline; test = trying something new. */
export function LabelBadge({ label }: { label: "proven" | "test" | null | undefined }) {
  if (label === "proven") return <Badge tone="good" icon={<BadgeCheck className="size-3.5" aria-hidden />}>Proven pattern</Badge>;
  if (label === "test") return <Badge tone="test" icon={<FlaskConical className="size-3.5" aria-hidden />}>Test</Badge>;
  return null;
}

/** PI shown as words and a multiple, never colour alone. */
export function PiBadge({ pi }: { pi: number | null | undefined }) {
  if (pi == null) return <Badge>No baseline yet</Badge>;
  const tone = pi >= 1.15 ? "good" : pi >= 0.85 ? "neutral" : "bad";
  const word = pi >= 1.15 ? "above usual" : pi >= 0.85 ? "about usual" : "below usual";
  return <Badge tone={tone}>{pi.toFixed(1)}× · {word}</Badge>;
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { /* clipboard blocked; nothing sensible to do */ }
      }}
      className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink", className)}
      aria-label={done ? "Copied" : `${label}`}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: "neutral" | "good" | "test" | "bad" | "accent"; text: string }> = {
    draft: { tone: "neutral", text: "Draft" },
    queued: { tone: "accent", text: "Waiting for studio" },
    delivered: { tone: "test", text: "Delivered" },
    acknowledged: { tone: "good", text: "In production" },
    failed: { tone: "bad", text: "Delivery failed" },
  };
  const m = map[status] ?? { tone: "neutral" as const, text: status };
  return <Badge tone={m.tone}>{m.text}</Badge>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
