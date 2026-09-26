import { clamp01 } from "../lib/stats.js";
import type { Goal } from "../types.js";

/**
 * Opportunity score (0-100):
 *   S = 100 * (0.30 L + 0.25 F + 0.15 P + 0.10 M + 0.10 W + 0.10 G)
 * Until a platform has 5 posts with results, L's weight moves to P.
 * Displayed as relative ("likely top third"), never as a virality percentage.
 */

export interface ScoreComponents {
  L: number | null; // learned fit: P(beats the brand's baseline)
  F: number; // brand fit (Claude rubric vs. Brand Brain)
  P: number; // proof: competitor outlier evidence
  M: number; // momentum
  W: number; // white space: 1 - nearest-neighbour similarity
  G: number; // goal fit
}

export const WEIGHTS = { L: 0.3, F: 0.25, P: 0.15, M: 0.1, W: 0.1, G: 0.1 } as const;
export const COLD_START_POSTS = 5;

export function opportunityScore(c: ScoreComponents, postsWithResults: number): number {
  const cold = postsWithResults < COLD_START_POSTS || c.L == null;
  const wL = cold ? 0 : WEIGHTS.L;
  const wP = cold ? WEIGHTS.P + WEIGHTS.L : WEIGHTS.P;
  const s =
    wL * clamp01(c.L ?? 0) + WEIGHTS.F * clamp01(c.F) + wP * clamp01(c.P) +
    WEIGHTS.M * clamp01(c.M) + WEIGHTS.W * clamp01(c.W) + WEIGHTS.G * clamp01(c.G);
  return Math.round(1000 * s) / 10;
}

/** P from competitor outlier ratios of similar posts: 1x -> 0, 2.5x -> ~0.6, 5x+ -> ~1. */
export function proofFromOutliers(ratios: number[]): number {
  if (ratios.length === 0) return 0;
  const best = Math.max(...ratios);
  return clamp01(Math.log(Math.max(best, 1)) / Math.log(5));
}

/** Format-to-goal table (G). Values are priors from the Buffer format data and the playbooks. */
const GOAL_FIT: Record<Goal, Record<string, number>> = {
  reach: { reel: 1, vertical_video: 1, short: 1, native_video: 0.8, carousel: 0.6, document_carousel: 0.6, photo_carousel: 0.7, text_post: 0.4, single_image: 0.4, long_form: 0.5, talking_head_video: 0.7, image_post: 0.4 },
  engagement: { carousel: 1, document_carousel: 1, reel: 0.8, vertical_video: 0.8, short: 0.7, text_post: 0.8, photo_carousel: 0.9, native_video: 0.7, talking_head_video: 0.7, long_form: 0.6, single_image: 0.5, image_post: 0.6 },
  leads: { document_carousel: 1, carousel: 0.9, long_form: 0.9, talking_head_video: 0.8, text_post: 0.7, reel: 0.7, vertical_video: 0.6, short: 0.6, native_video: 0.6, photo_carousel: 0.7, single_image: 0.4, image_post: 0.5 },
  sales: { reel: 0.9, carousel: 0.9, vertical_video: 0.8, short: 0.7, photo_carousel: 0.8, long_form: 0.8, document_carousel: 0.7, native_video: 0.7, talking_head_video: 0.7, single_image: 0.6, image_post: 0.6, text_post: 0.5 },
};

export function goalFit(goal: Goal, format: string | undefined): number {
  return format ? GOAL_FIT[goal][format] ?? 0.5 : 0.5;
}

/** Relative label from a score's rank among the brand's current candidates. */
export function relativeLabel(score: number, all: number[]): "top_third" | "middle_third" | "bottom_third" {
  const sorted = [...all].sort((a, b) => b - a);
  const rank = sorted.indexOf(score) / Math.max(1, sorted.length);
  return rank < 1 / 3 ? "top_third" : rank < 2 / 3 ? "middle_third" : "bottom_third";
}

/**
 * How much real evidence backs the estimate.
 * - high: only from the brand's own results (5+ posts on the platform, 6+ similar posts).
 * - medium: some own results, or outside proof: 2+ independent cited sources
 *   (market news, buyer questions, competitor posts) or a competitor post at 2.5x+.
 * - low: nothing cited yet; the idea rests on the Brand Brain alone.
 */
export function confidenceLabel(
  evidenceN: number, postsWithResults: number, outside: { sources: number; proof: number } = { sources: 0, proof: 0 },
): "low" | "medium" | "high" {
  const own = postsWithResults >= COLD_START_POSTS;
  if (own && evidenceN >= 6) return "high";
  if (own && evidenceN >= 2) return "medium";
  if (outside.sources >= 2 || outside.proof >= 0.55) return "medium";
  return "low";
}
