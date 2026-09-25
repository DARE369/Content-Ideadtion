/**
 * List prices per million tokens (USD). Used only for the cost log and budget
 * guardrails; replace estimates with measured numbers from the log in week 1.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cache reads bill at 10% of input, 5-minute cache writes at 125%; batch halves everything. */
export function costUsd(model: string, u: UsageLike, batch = false): number {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5"]!;
  const perTok = (usd: number) => usd / 1_000_000;
  const cost =
    u.input_tokens * perTok(p.input) +
    (u.cache_read_input_tokens ?? 0) * perTok(p.input) * 0.1 +
    (u.cache_creation_input_tokens ?? 0) * perTok(p.input) * 1.25 +
    u.output_tokens * perTok(p.output);
  return batch ? cost / 2 : cost;
}
