import type { Brief } from "../contracts/brief.js";
import type { IdeaCard } from "../contracts/idea.js";

/** Export stays: Idea Cards and briefs as Markdown, JSON or CSV. */

export type ExportFormat = "md" | "json" | "csv";

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportIdeas(cards: IdeaCard[], format: ExportFormat): string {
  if (format === "json") return JSON.stringify(cards, null, 2);
  if (format === "csv") {
    const cols = ["idea_id", "title", "why_now", "platform", "content_type", "label", "relative", "confidence", "effort", "score", "risks", "evidence"] as const;
    const rows = cards.map((c) => cols.map((k) => csvCell(k === "evidence" ? c.evidence.map((e) => e.url ?? e.id).join(" ") : k === "risks" ? c.risks.join("; ") : c[k])).join(","));
    return [cols.join(","), ...rows].join("\n");
  }
  return cards.map((c) => [
    `## ${c.title}`,
    `*${c.label === "proven" ? "Proven pattern" : "Test"} · likely ${c.relative.replace("_", " ")} of your posts · ${c.confidence} confidence · ${c.effort} effort*`,
    "",
    `**Why this, why now:** ${c.why_now}`,
    "",
    c.core_idea,
    "",
    c.evidence.length ? "**Evidence**" : "",
    ...c.evidence.map((e) => `- ${e.url ? `[${e.summary}](${e.url})` : e.summary}`),
    c.risks.length ? `\n**Risks:** ${c.risks.join("; ")}` : "",
  ].filter((l) => l !== "").join("\n")).join("\n\n---\n\n");
}

export function exportBrief(b: Brief, format: ExportFormat): string {
  if (format === "json") return JSON.stringify(b, null, 2);
  if (format === "csv") {
    const entries = Object.entries(b);
    return [entries.map(([k]) => k).join(","), entries.map(([, v]) => csvCell(v)).join(",")].join("\n");
  }
  const head = b.kind === "platform" ? `${b.platform} · ${b.format} · ${b.aspect_ratio}${b.length_seconds ? ` · ${b.length_seconds[0]}-${b.length_seconds[1]}s` : ""}` : `General brief · ${b.suggested_formats.join(", ")}`;
  const lines = [
    `# ${b.core_idea}`,
    `*${head} · ${b.language} · goal: ${b.goal} · brief ${b.brief_id}*`,
    "",
    "## Hooks",
    ...b.hooks.map((h, i) => `${i + 1}. ${h}`),
  ];
  if (b.kind === "general") lines.push("", "## Messaging", ...b.messaging.map((m) => `- ${m}`));
  if (b.structure?.length) {
    lines.push("", "## Structure", "| Time | Beat | On screen |", "| --- | --- | --- |",
      ...b.structure.map((s) => `| ${s.t} | ${s.beat} | ${s.on_screen_text ?? ""} |`));
  }
  if (b.kind === "platform" && b.title) lines.push("", `**Title:** ${b.title}`);
  if (b.kind === "platform" && b.thumbnail_brief) lines.push(`**Thumbnail:** ${b.thumbnail_brief}`);
  if (b.script_or_copy) lines.push("", "## Script / copy", b.script_or_copy);
  lines.push("", "## Visual direction", b.visual_direction.style, ...b.visual_direction.shots.map((s) => `- ${s}`));
  lines.push("", "## Caption", b.caption, "", `**CTA:** ${b.cta.text ?? b.cta.type}${b.cta.url ? ` → ${b.cta.url}` : ""}`);
  if (b.do_not.length) lines.push("", "## Do not", ...b.do_not.map((d) => `- ${d}`));
  return lines.join("\n");
}
