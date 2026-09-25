import type { Rng } from "../lib/stats.js";
import { EXPLOIT_MIN_PROB, combine, probBeatsBaseline, thompsonDraw, type EstimateIndex } from "./model.js";
import type { Features } from "../types.js";

/**
 * Explore vs. exploit. Most slots go to feature combinations with at least a
 * 0.7 chance of beating baseline ("proven"); a fixed share goes to Thompson
 * sampling over under-tested combinations ("test").
 */

export interface Candidate {
  id: string;
  features: Features;
  score: number; // opportunity score 0..100
}

export interface Selected<T extends Candidate> {
  item: T;
  slot: "exploit" | "explore";
  p_beat: number;
}

export function exploreSlots(total: number, exploreShare: number): number {
  if (total <= 0) return 0;
  // At least one test slot whenever exploring is allowed and there are 3+ slots.
  const n = Math.round(total * exploreShare);
  return exploreShare > 0 && total >= 3 ? Math.max(1, n) : n;
}

export function selectSlots<T extends Candidate>(
  candidates: T[],
  est: EstimateIndex,
  total: number,
  exploreShare: number,
  rng: Rng,
  coldStart = false,
): Selected<T>[] {
  const scored = candidates.map((c) => {
    const { mu, se } = combine(c.features, est);
    return { c, mu, se, p: probBeatsBaseline(mu, se) };
  });
  const out: Selected<T>[] = [];
  const used = new Set<string>();

  // Cold start (first 5 posts): everything is a test, ranked by opportunity score.
  if (coldStart) {
    return [...scored].sort((a, b) => b.c.score - a.c.score).slice(0, total)
      .map((s) => ({ item: s.c, slot: "explore", p_beat: s.p }));
  }

  const nExplore = exploreSlots(total, exploreShare);
  const nExploit = total - nExplore;

  // Exploit: only proven combinations, best opportunity score first.
  for (const s of scored.filter((s) => s.p >= EXPLOIT_MIN_PROB).sort((a, b) => b.c.score - a.c.score)) {
    if (out.length >= nExploit) break;
    out.push({ item: s.c, slot: "exploit", p_beat: s.p });
    used.add(s.c.id);
  }

  // Explore: Thompson sampling over what's left (score breaks ties), plus any
  // exploit slots we could not fill with proven ideas.
  const rest = scored
    .filter((s) => !used.has(s.c.id))
    .map((s) => ({ s, draw: thompsonDraw(s.mu, s.se, rng) + s.c.score / 1000 }))
    .sort((a, b) => b.draw - a.draw);
  for (const { s } of rest) {
    if (out.length >= total) break;
    out.push({ item: s.c, slot: s.p >= EXPLOIT_MIN_PROB ? "exploit" : "explore", p_beat: s.p });
  }
  return out;
}
