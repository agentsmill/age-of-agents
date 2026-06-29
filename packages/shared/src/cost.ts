/**
 * Cost estimation for AI coding sessions.
 *
 * Maps model name substrings to USD rates per 1M tokens.
 * Rates are approximate public pricing as of mid-2026.
 */

export interface ModelCost {
  /** Cost per 1M input tokens in USD. */
  inputPer1M: number;
  /** Cost per 1M output tokens in USD. */
  outputPer1M: number;
}

/** Default cost rates for known model families (USD per 1M tokens). */
export const DEFAULT_COSTS: Record<string, ModelCost> = {
  'claude-opus':       { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-sonnet':     { inputPer1M: 3.00,  outputPer1M: 15.00 },
  'claude-haiku':      { inputPer1M: 0.25,  outputPer1M: 1.25 },
  'gpt-4o-mini':       { inputPer1M: 0.15,  outputPer1M: 0.60 },
  'gpt-4o':            { inputPer1M: 2.50,  outputPer1M: 10.00 },
  'o3':                { inputPer1M: 10.00, outputPer1M: 40.00 },
  'o4-mini':           { inputPer1M: 1.10,  outputPer1M: 4.40 },
  'deepseek':          { inputPer1M: 0.27,  outputPer1M: 1.10 },
  'mimo':              { inputPer1M: 0.00,  outputPer1M: 0.00 },
  'gemini':            { inputPer1M: 1.25,  outputPer1M: 5.00 },
};

/**
 * Estimate cost in USD for a session given its token counts and model name.
 * Returns 0 when the model is unknown (safe default — no false cost).
 */
export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  model: string | undefined,
  costs: Record<string, ModelCost> = DEFAULT_COSTS,
): number {
  if (!model) return 0;
  const lower = model.toLowerCase();
  // Match longest key first to avoid 'claude' matching before 'claude-opus'.
  const key = Object.keys(costs)
    .sort((a, b) => b.length - a.length)
    .find((k) => lower.includes(k));
  if (!key) return 0;
  const c = costs[key];
  return (inputTokens / 1_000_000) * c.inputPer1M + (outputTokens / 1_000_000) * c.outputPer1M;
}

/** Format a USD cost for display. */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  if (usd < 1) return `$${usd.toFixed(2)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString()}`;
}
