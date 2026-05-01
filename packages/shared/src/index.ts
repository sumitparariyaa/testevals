export type PromptStrategyId = "zero_shot" | "few_shot" | "cot";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ClinicalExtraction {
  chief_complaint: string;
  vitals: {
    bp: string | null;
    hr: number | null;
    temp_f: number | null;
    spo2: number | null;
  };
  medications: Array<{
    name: string;
    dose: string | null;
    frequency: string | null;
    route: string | null;
  }>;
  diagnoses: Array<{
    description: string;
    icd10?: string;
  }>;
  plan: string[];
  follow_up: {
    interval_days: number | null;
    reason: string | null;
  };
}

export interface DatasetCase {
  id: string;
  transcript: string;
  gold: ClinicalExtraction;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface LlmAttemptTrace {
  attempt: number;
  request: unknown;
  response: unknown;
  schemaValid: boolean;
  validationErrors: string[];
  usage: TokenUsage;
}

export interface ExtractionResult {
  prediction: unknown;
  schemaValid: boolean;
  attempts: LlmAttemptTrace[];
  promptHash: string;
  usage: TokenUsage;
  wallTimeMs: number;
}

export interface FieldScores {
  chief_complaint: number;
  vitals: number;
  medications: number;
  diagnoses: number;
  plan: number;
  follow_up: number;
  overall: number;
}

export interface HallucinationFinding {
  field: string;
  value: string;
  reason: string;
}

export interface EvaluationResult {
  scores: FieldScores;
  schemaValid: boolean;
  schemaErrors: string[];
  hallucinations: HallucinationFinding[];
  details: Record<string, unknown>;
}

export interface CaseResult {
  transcriptId: string;
  status: "pending" | "running" | "completed" | "failed";
  transcript?: string;
  gold?: ClinicalExtraction;
  prediction?: unknown;
  evaluation?: EvaluationResult;
  trace: LlmAttemptTrace[];
  promptHash?: string;
  usage: TokenUsage;
  costUsd: number;
  wallTimeMs: number;
  error?: string;
  completedAt?: string;
}

export interface RunAggregate {
  aggregateF1: number;
  perField: FieldScores;
  hallucinationCount: number;
  schemaFailureCount: number;
  usage: TokenUsage;
  costUsd: number;
  completedCases: number;
  totalCases: number;
  durationMs: number;
}

export interface RunRecord {
  id: string;
  strategy: PromptStrategyId;
  model: string;
  status: RunStatus;
  promptHash: string;
  datasetFilter?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  aggregate: RunAggregate;
  cases: CaseResult[];
}

export interface StartRunRequest {
  strategy: PromptStrategyId;
  model?: string;
  dataset_filter?: string[];
  transcript_id?: string;
  force?: boolean;
}

export interface CompareRunResult {
  left: RunRecord;
  right: RunRecord;
  fields: Array<{
    field: keyof FieldScores;
    left: number;
    right: number;
    delta: number;
    winner: "left" | "right" | "tie";
  }>;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
  };
}
