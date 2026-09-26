import { sortEvidence, type Evidence } from "../contracts/idea.js";
import type { IdeationContext } from "./context.js";

const MARKET_KIND_TEXT: Record<string, string> = {
  news: "In the news", regulation: "Regulation", event: "Event", deal: "Deal", data: "New data",
  buyer_question: "Buyers are asking", competitor_content: "A competitor published",
};

/** Resolve cited ids into linked evidence, own winners first. Unknown ids are dropped. */
export function resolveEvidence(ctx: IdeationContext, ids: string[]): Evidence[] {
  const out: Evidence[] = [];
  for (const id of ids) {
    const own = ctx.ownPosts.find((p) => p.id === id);
    if (own) {
      out.push({ kind: "own_post", id, url: null, summary: `Your ${own.platform} post${own.pi != null ? ` did ${own.pi.toFixed(1)}× your baseline` : ""}: ${(own.caption ?? "").slice(0, 100)}` });
      continue;
    }
    const w = ctx.competitorWinners.find((x) => x.id === id);
    if (w) {
      out.push({ kind: "competitor_post", id, url: w.url, summary: `Competitor ${w.platform} post at ${w.outlier_ratio.toFixed(1)}× their median: ${(w.title ?? w.caption ?? "").slice(0, 100)}` });
      continue;
    }
    const q = ctx.questions.find((x) => x.id === id);
    if (q) {
      out.push({ kind: "comment", id, url: null, summary: `${q.origin === "own" ? "Your audience" : "A competitor's audience"} asked: "${q.text.slice(0, 140)}"` });
      continue;
    }
    const f = ctx.facts.find((x) => x.id === id);
    if (f) {
      out.push({ kind: "business", id, url: f.url, summary: `${f.product ? `${f.product}: ` : ""}${f.title}${f.body && f.body !== f.title ? ` — ${f.body.slice(0, 140)}` : ""}` });
      continue;
    }
    const s = ctx.signals.find((x) => x.id === id);
    if (s?.source === "claude_web_search") {
      out.push({ kind: "web", id, url: s.url, summary: `${MARKET_KIND_TEXT[s.kind ?? ""] ?? "In the news"}${s.published ? ` (${s.published})` : ""}: ${s.title ?? ""}` });
      continue;
    }
    if (s) out.push({ kind: "trend", id, url: s.url, summary: `${s.source.replace(/_/g, " ")}: ${s.title ?? ""}${s.momentum != null ? ` (momentum ${s.momentum.toFixed(2)})` : ""}` });
  }
  return sortEvidence(out);
}

/** P component: best outlier ratio among cited competitor winners. */
export function citedOutlierRatios(ctx: IdeationContext, ids: string[]): number[] {
  return ctx.competitorWinners.filter((w) => ids.includes(w.id)).map((w) => w.outlier_ratio);
}

/** M component: best momentum among cited trend signals; neutral-low when none is cited. */
export function citedMomentum(ctx: IdeationContext, ids: string[]): number {
  const m = ctx.signals.filter((s) => ids.includes(s.id) && s.momentum != null).map((s) => s.momentum!);
  return m.length ? Math.max(...m) : 0.3;
}
