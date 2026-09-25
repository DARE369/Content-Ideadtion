import { z } from "zod";
import { PLAYBOOK_DATA } from "./data.js";
import { PLATFORMS, type Platform } from "../types.js";

/**
 * Versioned per-platform playbooks drive the adapters. Configs are reviewed
 * monthly; anything older than 45 days raises an internal warning.
 */

export const Playbook = z.object({
  platform: z.enum(PLATFORMS),
  version: z.string(),
  reviewed_at: z.string().date(),
  design_for: z.array(z.string()),
  default_format: z.string(),
  formats: z.array(z.string()).min(1),
  length_seconds: z.tuple([z.number(), z.number()]).nullable(),
  aspect_ratio: z.string(),
  format_aspect_ratios: z.record(z.string(), z.string()).optional(),
  hook: z.string(),
  caption: z.string(),
  cta: z.array(z.string()).min(1),
  default_cta: z.string(),
  cta_phrasing: z.string().optional(),
  ranking_signals: z.array(z.string()),
  requires: z.array(z.string()).optional(),
  do_not: z.array(z.string()),
  notes: z.string().optional(),
});
export type Playbook = z.infer<typeof Playbook>;

export const STALE_AFTER_DAYS = 45;

const cache = new Map<Platform, Playbook>();

export function playbook(platform: Platform): Playbook {
  let p = cache.get(platform);
  if (!p) {
    p = Playbook.parse(PLAYBOOK_DATA[platform]);
    cache.set(platform, p);
  }
  return p;
}

export function stalePlaybooks(now = new Date()): { platform: Platform; ageDays: number }[] {
  return PLATFORMS.map((platform) => {
    const ageDays = Math.floor((now.getTime() - Date.parse(playbook(platform).reviewed_at)) / 86_400_000);
    return { platform, ageDays };
  }).filter((p) => p.ageDays > STALE_AFTER_DAYS);
}

export function aspectRatioFor(p: Playbook, format: string): string {
  return p.format_aspect_ratios?.[format] ?? p.aspect_ratio;
}
