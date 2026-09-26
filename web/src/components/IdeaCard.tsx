import { ChevronDown, ExternalLink, FileText, MessageCircle, TrendingUp, Trophy, Users, X } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { CONFIDENCE_TEXT, FEATURE_NAMES, featureValue, RELATIVE_TEXT } from "../lib/format";
import type { Evidence, IdeaCard as Idea } from "../lib/types";
import { LabelBadge, PlatformBadge } from "./bits";
import { Button, Card } from "./ui";

const EVIDENCE_ICON = { own_post: Trophy, comment: MessageCircle, competitor_post: Users, trend: TrendingUp, web: ExternalLink } as const;

export function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((e) => {
        const Icon = EVIDENCE_ICON[e.kind];
        return (
          <li key={e.id} className="flex items-start gap-2 text-sm text-ink-2">
            <Icon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">{e.summary}</a>
            ) : e.kind === "own_post" ? (
              <Link to={`/analytics/posts/${e.id}`} className="underline decoration-line-strong underline-offset-2 hover:text-ink">{e.summary}</Link>
            ) : <span>{e.summary}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const COMPONENTS: { key: "L" | "F" | "P" | "M" | "W" | "G"; name: string; help: string }[] = [
  { key: "L", name: "Fits what works for you", help: "Chance these features beat your usual, learned from your own posts" },
  { key: "F", name: "Brand fit", help: "Matches your pillars, voice, audience and language" },
  { key: "P", name: "Proof", help: "Similar competitor posts did far better than their usual" },
  { key: "M", name: "Momentum", help: "The topic is rising and hasn't peaked" },
  { key: "W", name: "White space", help: "Competitors haven't covered this angle" },
  { key: "G", name: "Goal fit", help: "The format suits your primary goal" },
];

function ScoreBreakdown({ c }: { c: NonNullable<Idea["score_components"]> }) {
  return (
    <dl className="grid gap-2.5">
      {COMPONENTS.map(({ key, name, help }) => {
        const v = c[key];
        return (
          <div key={key} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm">
            <dt className="text-ink-2" title={help}>{name}</dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              {v != null && <div className="h-full rounded-full bg-ink-2" style={{ width: `${Math.round(v * 100)}%` }} />}
            </dd>
            <dd className="text-right text-xs tabular-nums text-ink-3">{v == null ? "n/a" : `${Math.round(v * 100)}`}</dd>
          </div>
        );
      })}
      {c.L == null && <p className="text-xs text-ink-3">"Fits what works for you" switches on after 5 posts with results on this platform. Until then, proof counts for more.</p>}
    </dl>
  );
}

export function IdeaCardView({ idea, onBrief, onDismiss }: { idea: Idea; onBrief: () => void; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const visibleEvidence = idea.evidence.slice(0, 2);
  const features = Object.entries(idea.features).filter(([k]) => ["hook_type", "format", "pillar", "visual_style"].includes(k));

  return (
    <Card as="article" className="p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PlatformBadge platform={idea.platform} />
        {idea.content_type && <span className="text-xs text-ink-3">{featureValue("format", idea.content_type)}</span>}
        <LabelBadge label={idea.label} />
        <span className="ml-auto text-xs text-ink-3">{idea.effort === "low" ? "Quick to make" : idea.effort === "medium" ? "Some effort" : "Bigger shoot"}</span>
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug">{idea.title}</h3>
      <p className="mt-1.5 text-sm text-ink-2"><span className="font-medium text-ink">Why now: </span>{idea.why_now}</p>

      <p className="mt-3 text-sm">
        <span className="font-medium">{RELATIVE_TEXT[idea.relative]}</span>
        <span className="text-ink-3"> · {CONFIDENCE_TEXT[idea.confidence]}</span>
      </p>

      {visibleEvidence.length > 0 && <div className="mt-4"><EvidenceList items={visibleEvidence} /></div>}

      {open && (
        <div id={detailsId} className="mt-5 grid gap-5 border-t border-line pt-5 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">The idea</h4>
              <p className="mt-1.5 text-sm">{idea.core_idea}</p>
            </div>
            {idea.evidence.length > 2 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">More evidence</h4>
                <div className="mt-2"><EvidenceList items={idea.evidence.slice(2)} /></div>
              </div>
            )}
            {features.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Planned</h4>
                <dl className="mt-2 flex flex-wrap gap-1.5">
                  {features.map(([k, v]) => (
                    <div key={k} className="rounded-md bg-surface-2 px-2 py-1 text-xs"><dt className="inline text-ink-3">{FEATURE_NAMES[k]}: </dt><dd className="inline">{featureValue(k, v)}</dd></div>
                  ))}
                </dl>
              </div>
            )}
            {idea.risks.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Watch out for</h4>
                <ul className="mt-1.5 list-inside list-disc text-sm text-ink-2">{idea.risks.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
          </div>
          {idea.score_components && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Why it's ranked here</h4>
              <div className="mt-3"><ScoreBreakdown c={idea.score_components} /></div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onBrief} icon={<FileText className="size-4" />}>Create brief</Button>
        <Button variant="ghost" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}
          icon={<ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />}>
          {open ? "Less" : "Details"}
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={onDismiss} icon={<X className="size-4" />} aria-label={`Not for us: ${idea.title}`}>
          <span className="hidden sm:inline">Not for us</span>
        </Button>
      </div>
    </Card>
  );
}
