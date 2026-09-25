import type { Db } from "../db.js";
import { normalCdf, sampleNormal, type Rng } from "../lib/stats.js";
import type { Features, Platform } from "../types.js";

/**
 * The learning model. For each brand x platform x feature value the database
 * keeps a shrunk estimate of log(PI) (view v_feature_estimates):
 *   mu_hat = (n * mean + k * mu_prior) / (n + k), k = 5
 * Here we turn those estimates into probabilities and Thompson samples.
 */

export const SHRINKAGE_K = 5;
export const EXPLOIT_MIN_PROB = 0.7;

export interface FeatureEstimate {
  feature: string;
  value: string;
  n: number;
  mu_hat: number;
  se: number;
}

export interface EstimateIndex {
  /** The brand's mean log(PI) on this platform (0 with no data). */
  intercept: number;
  byKey: Map<string, FeatureEstimate>;
}

const key = (feature: string, value: string) => `${feature}=${value}`;

export function shrink(n: number, mean: number, prior: number, k = SHRINKAGE_K): number {
  return (n * mean + k * prior) / (n + k);
}

export async function loadEstimates(db: Db, workspaceId: string, platform: Platform): Promise<EstimateIndex> {
  const [res, pooled] = await Promise.all([
    db.query<{ feature: string; value: string; n: string; mu_hat: string; se: string }>(
      "select feature, value, n, mu_hat, se from v_feature_estimates where workspace_id = $1 and platform = $2",
      [workspaceId, platform],
    ),
    db.query<{ mean_log_pi: string | null }>(
      "select mean_log_pi from v_pooled_variance where workspace_id = $1 and platform = $2", [workspaceId, platform],
    ),
  ]);
  return {
    intercept: Number(pooled.rows[0]?.mean_log_pi ?? 0),
    byKey: new Map(
      res.rows.map((r) => [key(r.feature, r.value), { feature: r.feature, value: r.value, n: Number(r.n), mu_hat: Number(r.mu_hat), se: Number(r.se) }]),
    ),
  };
}

/**
 * Combine per-feature estimates for one idea (an additive model on log PI):
 *   mu = intercept + sum over seen feature values of (mu_hat - intercept)
 * The intercept is the brand's typical log(PI); each shrunk estimate becomes a
 * deviation from it, so a feature present on every post (e.g. all reels) adds
 * nothing, and unseen values add nothing either. Correlated features can
 * double-count, which the shrinkage (k = 5) and the 0.7 exploit bar temper.
 * Uncertainty is the typical uncertainty of the estimates used. With no seen
 * values the idea sits at the neutral prior: a coin flip, i.e. a test.
 */
export function combine(features: Features, est: EstimateIndex): { mu: number; se: number; evidenceN: number } {
  const seen = Object.entries(features)
    .filter(([f, v]) => v && f !== "language")
    .map(([f, v]) => est.byKey.get(key(f, v!)))
    .filter((e): e is FeatureEstimate => !!e && e.n > 0);
  if (seen.length === 0) return { mu: 0, se: 0.7 / Math.sqrt(SHRINKAGE_K), evidenceN: 0 };
  const mu = est.intercept + seen.reduce((s, p) => s + (p.mu_hat - est.intercept), 0);
  const se = Math.sqrt(seen.reduce((s, p) => s + p.se * p.se, 0) / seen.length);
  return { mu, se, evidenceN: Math.min(...seen.map((p) => p.n)) };
}

/** P(PI > 1) = P(log PI > 0). */
export function probBeatsBaseline(mu: number, se: number): number {
  return se > 0 ? normalCdf(mu / se) : mu > 0 ? 1 : 0;
}

/** One Thompson draw of log(PI) for an idea. */
export function thompsonDraw(mu: number, se: number, rng: Rng): number {
  return sampleNormal(mu, se, rng);
}
