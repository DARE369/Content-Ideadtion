import { ApiError } from "./api";
import type { BriefPayload, Platform } from "./types";

export interface RefinedIdea {
  idea_id: string; title: string; core_idea: string; why_now: string; score: number; relative: string; confidence: string;
  label: "test"; features: Record<string, string>;
}

export type RefineEvent =
  | { type: "verdict_delta"; text: string }
  | { type: "verdict_done"; text: string }
  | { type: "ideas"; sharpened: RefinedIdea; alternatives: RefinedIdea[] }
  | { type: "platform_brief"; platform: Platform | "general"; brief: BriefPayload }
  | { type: "error"; message: string }
  | { type: "done" };

/** POST + server-sent events (EventSource only does GET), parsed from the fetch body stream. */
export async function refineStream(
  ws: string, idea: string, platforms: Platform[], onEvent: (e: RefineEvent) => void, signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/v1/workspaces/${ws}/refine`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea, platforms }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    let msg = `Refine failed (${res.status}).`;
    try {
      msg = JSON.parse(t).error ?? msg;
    } catch { /* keep default */ }
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data) onEvent(JSON.parse(data) as RefineEvent);
    }
  }
}
