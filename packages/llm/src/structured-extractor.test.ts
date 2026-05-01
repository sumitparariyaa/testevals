import { describe, expect, test } from "bun:test";

import { getPromptStrategy, promptHash } from "./prompts";
import { AnthropicStructuredExtractor } from "./structured-extractor";

const validExtraction = {
  chief_complaint: "cough",
  vitals: { bp: null, hr: null, temp_f: null, spo2: null },
  medications: [],
  diagnoses: [],
  plan: ["supportive care"],
  follow_up: { interval_days: null, reason: null },
};

describe("AnthropicStructuredExtractor", () => {
  test("retries with schema error feedback", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      messages: {
        create: async (request: Record<string, unknown>) => {
          requests.push(request);
          if (requests.length === 1) {
            return {
              content: [
                {
                  type: "tool_use",
                  id: "tool_1",
                  name: "emit_clinical_extraction",
                  input: { chief_complaint: "cough" },
                },
              ],
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          }

          return {
            content: [
              {
                type: "tool_use",
                id: "tool_2",
                name: "emit_clinical_extraction",
                input: validExtraction,
              },
            ],
            usage: { input_tokens: 8, output_tokens: 4, cache_read_input_tokens: 100 },
          };
        },
      },
    };
    const extractor = new AnthropicStructuredExtractor({ client, maxAttempts: 3 });

    const result = await extractor.extract({
      transcript: "Patient has a cough. Supportive care.",
      strategy: "zero_shot",
      model: "claude-haiku-4-5-20251001",
    });

    expect(result.schemaValid).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.validationErrors.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests[1])).toContain("Schema validation failed");
    expect(result.usage.cacheReadInputTokens).toBe(100);
  });

  test("prompt hash is stable and prompt-sensitive", () => {
    const first = promptHash(getPromptStrategy("zero_shot"));
    const second = promptHash(getPromptStrategy("zero_shot"));
    const different = promptHash(getPromptStrategy("few_shot"));

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });
});
