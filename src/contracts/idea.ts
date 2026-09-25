import { z } from "zod";

export const EvidenceKind = z.enum(["own_post", "competitor_post", "trend", "comment", "web"]);

export const Evidence = z.object({
  kind: EvidenceKind,
  id: z.string(),
  url: z.string().nullable(),
  summary: z.string(),
});
export type Evidence = z.infer<typeof Evidence>;

/** Evidence order on every card: own past winners first, then competitors, then trends. */
const ORDER: Record<z.infer<typeof EvidenceKind>, number> = {
  own_post: 0, comment: 1, competitor_post: 2, trend: 3, web: 4,
};
export function sortEvidence(e: Evidence[]): Evidence[] {
  return [...e].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/** What the API returns for an Idea Card. */
export interface IdeaCard {
  idea_id: string;
  title: string;
  why_now: string;
  core_idea: string;
  platform: string | null;
  evidence: Evidence[];
  score: number;
  relative: "top_third" | "middle_third" | "bottom_third";
  confidence: "low" | "medium" | "high";
  content_type: string;
  effort: "low" | "medium" | "high";
  risks: string[];
  label: "proven" | "test";
  features: Record<string, string>;
}
