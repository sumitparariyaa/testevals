import type { TokenUsage } from "@test-evals/shared";

const MILLION = 1_000_000;

const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-haiku-4-5-20251001": {
    input: 1,
    output: 5,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
};

const DEFAULT_PRICE = MODEL_PRICES["claude-haiku-4-5-20251001"] ?? {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheWrite: 1.25,
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE;

  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.cacheCreationInputTokens * price.cacheWrite) /
    MILLION
  );
}
