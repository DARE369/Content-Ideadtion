import { clamp01, mean } from "../lib/stats.js";

/**
 * Momentum in 0..1: high when a topic is rising and has not yet peaked.
 * 0.5 means flat. Used by the opportunity score (M component).
 */
export function momentumFromSeries(daily: readonly number[]): number | null {
  if (daily.length < 14) return null;
  const last7 = daily.slice(-7);
  const prior = daily.slice(-28, -7);
  const recent = mean(last7)!;
  const base = mean(prior) ?? 0;
  if (recent === 0 && base === 0) return 0;
  const ratio = (recent + 1) / (base + 1);
  let m = 1 / (1 + Math.exp(-1.5 * Math.log(ratio)));
  // Peaked: the last 3 days have fallen well below the 7-day high.
  const last3 = mean(daily.slice(-3))!;
  const peak = Math.max(...last7);
  if (peak > 0 && last3 / peak < 0.6) m *= 0.6;
  return clamp01(m);
}

/** Google Trends "approx traffic" strings like "2,000+" or "200K+". */
export function parseApproxTraffic(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^([\d,.]+)\s*([KkMm])?\+?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  const mult = m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1;
  return n * mult;
}

/** Trending-now items are rising by definition; scale by search volume. */
export function momentumFromTraffic(traffic: number | null): number | null {
  if (traffic == null) return null;
  return clamp01(0.55 + 0.45 * Math.min(1, Math.log10(Math.max(traffic, 1)) / 6));
}
