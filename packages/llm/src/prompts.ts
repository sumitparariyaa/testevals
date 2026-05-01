import { createHash } from "node:crypto";

import type { PromptStrategyId } from "@test-evals/shared";

import schema from "../../../data/schema.json";

export interface PromptStrategy {
  id: PromptStrategyId;
  label: string;
  instructions: string;
  examples: string;
}

const BASE_INSTRUCTIONS = `You extract structured clinical facts from a synthetic doctor-patient transcript.
Use only information supported by the transcript. Unknown vitals and follow-up fields must be null.
Return exactly one call to the emit_clinical_extraction tool. Do not put JSON in free text.`;

const EXAMPLE_BLOCK = `Example A
Transcript: Patient reports three days of sore throat and dry cough. Vitals: BP 122/78, HR 84, temp 99.1 F, SpO2 98%. Clinician diagnoses viral URI, recommends fluids, rest, and acetaminophen 500 mg by mouth every 6 hours as needed. Follow up in 7 days if not improving.
Extraction: chief complaint "sore throat and dry cough"; vitals 122/78, 84, 99.1, 98; medication acetaminophen 500 mg every 6 hours PO; diagnosis viral URI; plan fluids, rest, acetaminophen PRN; follow_up interval_days 7 reason not improving.

Example B
Transcript: Patient with type 2 diabetes here for medication refill. No acute complaint. BP 136/82, pulse 72. Continue metformin 1000 mg twice daily by mouth and check A1c. Follow up in three months for diabetes review.
Extraction: chief complaint "diabetes medication refill"; BP 136/82, HR 72, other vitals null; medication metformin 1000 mg twice daily PO; diagnosis type 2 diabetes; plan continue metformin and check A1c; follow_up interval_days 90 reason diabetes review.`;

export const PROMPT_STRATEGIES: Record<PromptStrategyId, PromptStrategy> = {
  zero_shot: {
    id: "zero_shot",
    label: "Zero Shot",
    instructions:
      "Extract the encounter into the schema. Prefer concise field values and preserve units as spoken when possible.",
    examples: "",
  },
  few_shot: {
    id: "few_shot",
    label: "Few Shot",
    instructions:
      "Use the examples as calibration for granularity, medication normalization, and null handling. Match their concise style.",
    examples: EXAMPLE_BLOCK,
  },
  cot: {
    id: "cot",
    label: "Grounded Check",
    instructions:
      "Before calling the tool, privately check every value against the transcript, reconcile repeated facts, and remove unsupported guesses. Do not reveal reasoning.",
    examples: EXAMPLE_BLOCK,
  },
};

export function getPromptStrategy(id: PromptStrategyId): PromptStrategy {
  return PROMPT_STRATEGIES[id];
}

export function buildSystemPrompt(strategy: PromptStrategy): string {
  return [BASE_INSTRUCTIONS, strategy.instructions, strategy.examples].filter(Boolean).join("\n\n");
}

export function promptHash(strategy: PromptStrategy): string {
  const hashInput = JSON.stringify({
    base: BASE_INSTRUCTIONS,
    strategy,
    schema,
  });

  return createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
}
