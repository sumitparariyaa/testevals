import { env } from "@test-evals/env/server";
import { AnthropicStructuredExtractor, estimateCostUsd, getPromptStrategy, promptHash } from "@test-evals/llm";
import type { ExtractionResult, PromptStrategyId, TokenUsage } from "@test-evals/shared";

import { loadDatasetCase } from "./dataset.service";

export interface Extractor {
  extract: (params: {
    transcript: string;
    transcriptId?: string;
    strategy: PromptStrategyId;
    model: string;
  }) => Promise<ExtractionResult>;
  estimateCost?: (model: string, usage: TokenUsage) => number;
}

class FixtureExtractor implements Extractor {
  async extract(params: {
    transcript: string;
    transcriptId?: string;
    strategy: PromptStrategyId;
    model: string;
  }): Promise<ExtractionResult> {
    const start = Date.now();
    const strategy = getPromptStrategy(params.strategy);
    const hash = promptHash(strategy);
    const prediction = params.transcriptId
      ? (await loadDatasetCase(params.transcriptId)).gold
      : {
          chief_complaint: "fixture extraction",
          vitals: { bp: null, hr: null, temp_f: null, spo2: null },
          medications: [],
          diagnoses: [],
          plan: [],
          follow_up: { interval_days: null, reason: null },
        };
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };

    return {
      prediction,
      schemaValid: true,
      promptHash: hash,
      usage,
      wallTimeMs: Date.now() - start,
      attempts: [
        {
          attempt: 1,
          request: {
            provider: "fixture",
            model: params.model,
            strategy: params.strategy,
            transcriptId: params.transcriptId,
          },
          response: {
            provider: "fixture",
            note: "Local smoke-test provider. Production runs use Anthropic tool use.",
            prediction,
          },
          schemaValid: true,
          validationErrors: [],
          usage,
        },
      ],
    };
  }

  estimateCost(): number {
    return 0;
  }
}

export function createExtractor(): Extractor {
  const provider = process.env.LLM_PROVIDER ?? env.LLM_PROVIDER;
  if (provider === "fixture") {
    return new FixtureExtractor();
  }

  return new AnthropicStructuredExtractor({ apiKey: env.ANTHROPIC_API_KEY });
}

export { estimateCostUsd };
