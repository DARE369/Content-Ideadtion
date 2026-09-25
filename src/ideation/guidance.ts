import type { Candidate, Selected } from "../learning/selection.js";

export interface GuidanceRule {
  feature: string;
  value: string;
  action: string;
  share: number | null;
}

/**
 * Apply "what next" rules from the last report to a platform's selection:
 *  - prefer with a share: make sure at least that share of picks has the feature value
 *    (swapping in the best-scoring matching candidates for the weakest non-matching picks);
 *  - avoid: drop picks with the value from exploit slots, backfilling from the rest.
 * "test" rules are left to the ideator prompt, which already sees them.
 */
export function applyGuidance<T extends Candidate>(picks: Selected<T>[], pool: T[], rules: GuidanceRule[]): Selected<T>[] {
  let out = [...picks];
  const has = (c: T, r: GuidanceRule) => (c.features as Record<string, string | undefined>)[r.feature] === r.value;

  for (const r of rules.filter((r) => r.action === "avoid")) {
    const kept = out.filter((p) => !(p.slot === "exploit" && has(p.item, r)));
    const used = new Set(kept.map((p) => p.item.id));
    const fill = pool.filter((c) => !used.has(c.id) && !has(c, r)).sort((a, b) => b.score - a.score);
    while (kept.length < out.length && fill.length) kept.push({ item: fill.shift()!, slot: "explore", p_beat: 0 });
    out = kept;
  }

  for (const r of rules.filter((r) => r.action === "prefer" && r.share != null)) {
    const need = Math.ceil(r.share! * out.length);
    let have = out.filter((p) => has(p.item, r)).length;
    const used = new Set(out.map((p) => p.item.id));
    const extra = pool.filter((c) => !used.has(c.id) && has(c, r)).sort((a, b) => b.score - a.score);
    while (have < need && extra.length) {
      const weakest = out
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !has(p.item, r))
        .sort((a, b) => a.p.item.score - b.p.item.score)[0];
      if (!weakest) break;
      out[weakest.i] = { item: extra.shift()!, slot: weakest.p.slot, p_beat: weakest.p.p_beat };
      have++;
    }
  }
  return out;
}
