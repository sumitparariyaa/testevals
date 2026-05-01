import { describe, expect, test } from "bun:test";

import type { ExtractionResult } from "@test-evals/shared";

import { EvalRunner } from "./runner.service";
import { createRun, saveRun } from "./store.service";

function extraction(): ExtractionResult {
  return {
    prediction: {
      chief_complaint: "cough",
      vitals: { bp: null, hr: null, temp_f: null, spo2: null },
      medications: [],
      diagnoses: [],
      plan: ["supportive care"],
      follow_up: { interval_days: null, reason: null },
    },
    schemaValid: true,
    attempts: [],
    promptHash: "unit-hash",
    usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    wallTimeMs: 1,
  };
}

describe("EvalRunner", () => {
  test("resumes from the last completed case", async () => {
    let calls = 0;
    const model = `unit-resume-${Date.now()}`;
    const run = await createRun({ strategy: "zero_shot", model }, ["case_001", "case_002"]);
    run.cases[0] = {
      transcriptId: "case_001",
      status: "completed",
      trace: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      costUsd: 0,
      wallTimeMs: 1,
      evaluation: {
        scores: { chief_complaint: 1, vitals: 1, medications: 1, diagnoses: 1, plan: 1, follow_up: 1, overall: 1 },
        schemaValid: true,
        schemaErrors: [],
        hallucinations: [],
        details: {},
      },
    };
    await saveRun(run);

    const runner = new EvalRunner({
      concurrency: 2,
      extractor: {
        extract: async () => {
          calls += 1;
          return extraction();
        },
      },
    });
    const completed = await runner.resume(run.id);

    expect(completed.cases.filter((caseResult) => caseResult.status === "completed")).toHaveLength(2);
    expect(calls).toBe(1);
  });

  test("uses cached case result for idempotent reruns", async () => {
    let calls = 0;
    const model = `unit-cache-${Date.now()}`;
    const runner = new EvalRunner({
      concurrency: 1,
      extractor: {
        extract: async () => {
          calls += 1;
          return extraction();
        },
      },
    });

    await runner.runToCompletion({ strategy: "zero_shot", model, dataset_filter: ["case_001"] });
    await runner.runToCompletion({ strategy: "zero_shot", model, dataset_filter: ["case_001"] });

    expect(calls).toBe(1);
  });
});
