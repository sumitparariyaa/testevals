import Anthropic from "@anthropic-ai/sdk";

import { addUsage, EMPTY_USAGE, type ExtractionResult, type LlmAttemptTrace, type PromptStrategyId, type TokenUsage } from "@test-evals/shared";

import { estimateCostUsd } from "./pricing";
import { buildSystemPrompt, getPromptStrategy, promptHash } from "./prompts";
import { extractionTool, validateExtraction } from "./validation";

interface MessagesClient {
  messages: {
    create: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
}

export interface StructuredExtractorOptions {
  apiKey?: string;
  client?: MessagesClient;
  maxAttempts?: number;
}

export interface ExtractParams {
  transcript: string;
  transcriptId?: string;
  strategy: PromptStrategyId;
  model: string;
}

function readUsage(response: Record<string, unknown>): TokenUsage {
  const usage = (response.usage ?? {}) as Record<string, number | undefined>;

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens:
      usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens ?? 0,
  };
}

function findToolUse(response: Record<string, unknown>): { id: string; input: unknown } | null {
  const content = response.content;
  if (!Array.isArray(content)) {
    return null;
  }

  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "tool_use" &&
      (block as { name?: string }).name === extractionTool.name
    ) {
      return {
        id: String((block as { id?: string }).id ?? "tool_use"),
        input: (block as { input?: unknown }).input,
      };
    }
  }

  return null;
}

function emptyInvalidExtraction(): Record<string, unknown> {
  return {
    chief_complaint: "",
    vitals: {},
    medications: [],
    diagnoses: [],
    plan: [],
    follow_up: {},
  };
}

export class AnthropicStructuredExtractor {
  private readonly client: MessagesClient;
  private readonly maxAttempts: number;

  constructor(options: StructuredExtractorOptions = {}) {
    this.client =
      options.client ??
      ({
        messages: new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY }).messages,
      } as unknown as MessagesClient);
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async extract(params: ExtractParams): Promise<ExtractionResult> {
    const start = Date.now();
    const strategy = getPromptStrategy(params.strategy);
    const hash = promptHash(strategy);
    const systemText = buildSystemPrompt(strategy);
    const system = [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" },
      },
    ];
    const messages: Array<Record<string, unknown>> = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcript:\n${params.transcript}`,
          },
        ],
      },
    ];
    const attempts: LlmAttemptTrace[] = [];
    let usage = EMPTY_USAGE;
    let lastPrediction: unknown = emptyInvalidExtraction();
    let lastErrors: string[] = ["No attempt completed."];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const request = {
        model: params.model,
        max_tokens: 1800,
        temperature: 0,
        system,
        messages,
        tools: [extractionTool],
        tool_choice: { type: "tool", name: extractionTool.name },
      };
      const response = await this.client.messages.create(request);
      const attemptUsage = readUsage(response);
      usage = addUsage(usage, attemptUsage);

      const toolUse = findToolUse(response);
      const prediction = toolUse?.input ?? emptyInvalidExtraction();
      const validation = validateExtraction(prediction);
      lastPrediction = prediction;
      lastErrors = toolUse ? validation.errors : ["Model did not call emit_clinical_extraction."];

      attempts.push({
        attempt,
        request,
        response,
        schemaValid: Boolean(toolUse && validation.valid),
        validationErrors: lastErrors,
        usage: attemptUsage,
      });

      if (toolUse && validation.valid) {
        return {
          prediction,
          schemaValid: true,
          attempts,
          promptHash: hash,
          usage,
          wallTimeMs: Date.now() - start,
        };
      }

      messages.push({ role: "assistant", content: response.content ?? [] });
      if (toolUse) {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUse.id,
              is_error: true,
              content: `Schema validation failed. Fix only these errors and call ${extractionTool.name} again:\n${lastErrors.join("\n")}`,
            },
          ],
        });
      } else {
        messages.push({
          role: "user",
          content: `You must call ${extractionTool.name}. Validation errors: ${lastErrors.join("; ")}`,
        });
      }
    }

    return {
      prediction: lastPrediction,
      schemaValid: false,
      attempts,
      promptHash: hash,
      usage,
      wallTimeMs: Date.now() - start,
    };
  }

  estimateCost(model: string, usage: TokenUsage): number {
    return estimateCostUsd(model, usage);
  }
}
