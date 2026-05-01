import type { ClinicalExtraction, EvaluationResult, FieldScores, HallucinationFinding } from "@test-evals/shared";
import { validateExtraction } from "@test-evals/llm";

const FIELD_KEYS = ["chief_complaint", "vitals", "medications", "diagnoses", "plan", "follow_up"] as const;

type Scalar = string | number | null | undefined;

interface SetScore<TPredicted, TGold> {
  precision: number;
  recall: number;
  f1: number;
  matches: Array<{ predicted: TPredicted; gold: TGold }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clean(value: Scalar): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9./\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(value: Scalar): string {
  return clean(value)
    .replace(/\bdegrees?\b/g, "")
    .replace(/\bfahrenheit\b/g, "f")
    .replace(/\bper os\b/g, "po")
    .replace(/\boral\b/g, "po")
    .replace(/\bby mouth\b/g, "po")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: Scalar): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const insert = (current[j - 1] ?? 0) + 1;
      const remove = (previous[j] ?? 0) + 1;
      const substitute = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(insert, remove, substitute);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}

function similarity(left: Scalar, right: Scalar): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

export function tokenSetRatio(left: Scalar, right: Scalar): number {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const precision = intersection.length / leftTokens.size;
  const recall = intersection.length / rightTokens.size;
  const overlap = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return Math.max(overlap, similarity(left, right));
}

export function normalizeFrequency(value: Scalar): string {
  const normalized = normalizeText(value)
    .replace(/\btwice daily\b/g, "bid")
    .replace(/\btwo times daily\b/g, "bid")
    .replace(/\b2 times daily\b/g, "bid")
    .replace(/\bonce daily\b/g, "daily")
    .replace(/\bevery day\b/g, "daily")
    .replace(/\bthree times daily\b/g, "tid")
    .replace(/\bfour times daily\b/g, "qid")
    .replace(/\bevery (\d+) hours?\b/g, "q$1h")
    .replace(/\bq (\d+) h\b/g, "q$1h")
    .replace(/\bq(\d+) hours?\b/g, "q$1h");

  return normalized.replace(/\s+/g, "");
}

export function normalizeDose(value: Scalar): string {
  return normalizeText(value)
    .replace(/\bmilligrams?\b/g, "mg")
    .replace(/\bmicrograms?\b/g, "mcg")
    .replace(/\bgrams?\b/g, "g")
    .replace(/\s+/g, "");
}

export function normalizeRoute(value: Scalar): string {
  return normalizeText(value)
    .replace(/\bby mouth\b/g, "po")
    .replace(/\borally\b/g, "po")
    .replace(/\boral\b/g, "po")
    .replace(/\binhalation\b/g, "inhaled")
    .replace(/\s+/g, "");
}

function scalarExact(left: Scalar, right: Scalar): number {
  return normalizeText(left) === normalizeText(right) ? 1 : 0;
}

function numericExact(left: unknown, right: unknown, tolerance = 0): number {
  if (left == null && right == null) {
    return 1;
  }
  if (left == null || right == null) {
    return 0;
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return 0;
  }

  return Math.abs(leftNumber - rightNumber) <= tolerance ? 1 : 0;
}

export function scoreSet<TPredicted, TGold>(
  predicted: TPredicted[],
  gold: TGold[],
  isMatch: (predicted: TPredicted, gold: TGold) => boolean,
): SetScore<TPredicted, TGold> {
  const usedGold = new Set<number>();
  const matches: Array<{ predicted: TPredicted; gold: TGold }> = [];

  for (const predictedItem of predicted) {
    const goldIndex = gold.findIndex((goldItem, index) => !usedGold.has(index) && isMatch(predictedItem, goldItem));
    if (goldIndex >= 0) {
      usedGold.add(goldIndex);
      const goldItem = gold[goldIndex];
      if (goldItem !== undefined) {
        matches.push({ predicted: predictedItem, gold: goldItem });
      }
    }
  }

  const precision = predicted.length === 0 ? (gold.length === 0 ? 1 : 0) : matches.length / predicted.length;
  const recall = gold.length === 0 ? (predicted.length === 0 ? 1 : 0) : matches.length / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1, matches };
}

function medicationMatches(predicted: Record<string, unknown>, gold: ClinicalExtraction["medications"][number]): boolean {
  const nameMatch = tokenSetRatio(predicted.name as Scalar, gold.name) >= 0.82;
  const doseMatch = normalizeDose(predicted.dose as Scalar) === normalizeDose(gold.dose);
  const frequencyMatch = normalizeFrequency(predicted.frequency as Scalar) === normalizeFrequency(gold.frequency);
  const routePredicted = normalizeRoute(predicted.route as Scalar);
  const routeGold = normalizeRoute(gold.route);
  const routeMatch = routeGold === "" || routePredicted === "" || routePredicted === routeGold;

  return nameMatch && doseMatch && frequencyMatch && routeMatch;
}

function diagnosisScore(predicted: Array<Record<string, unknown>>, gold: ClinicalExtraction["diagnoses"]): number {
  const setScore = scoreSet(predicted, gold, (predictedItem, goldItem) => {
    return tokenSetRatio(predictedItem.description as Scalar, goldItem.description) >= 0.78;
  });
  if (setScore.matches.length === 0) {
    return setScore.f1;
  }

  const icdMatches = setScore.matches.filter(({ predicted: predictedItem, gold: goldItem }) => {
    const predictedCode = normalizeText(predictedItem.icd10 as Scalar).toUpperCase();
    const goldCode = normalizeText(goldItem.icd10).toUpperCase();
    return goldCode && predictedCode === goldCode;
  }).length;
  const bonus = (icdMatches / Math.max(1, gold.length)) * 0.05;

  return Math.min(1, setScore.f1 + bonus);
}

function scoreVitals(predictedVitals: Record<string, unknown>, goldVitals: ClinicalExtraction["vitals"]): number {
  const scores = [
    scalarExact(predictedVitals.bp as Scalar, goldVitals.bp),
    numericExact(predictedVitals.hr, goldVitals.hr),
    numericExact(predictedVitals.temp_f, goldVitals.temp_f, 0.2),
    numericExact(predictedVitals.spo2, goldVitals.spo2),
  ];

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function scoreFollowUp(predictedFollowUp: Record<string, unknown>, goldFollowUp: ClinicalExtraction["follow_up"]): number {
  const intervalScore = numericExact(predictedFollowUp.interval_days, goldFollowUp.interval_days);
  const predictedReason = predictedFollowUp.reason as Scalar;
  const reasonScore =
    predictedReason == null && goldFollowUp.reason == null ? 1 : tokenSetRatio(predictedReason, goldFollowUp.reason);

  return (intervalScore + reasonScore) / 2;
}

function collectScalarValues(value: unknown, prefix = ""): Array<{ field: string; value: string }> {
  if (value == null) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [{ field: prefix, value: text }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectScalarValues(item, `${prefix}[${index}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => collectScalarValues(nested, prefix ? `${prefix}.${key}` : key));
  }

  return [];
}

function hasGrounding(value: string, transcript: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedTranscript = normalizeText(transcript);
  if (!normalizedValue) {
    return true;
  }
  if (normalizedTranscript.includes(normalizedValue)) {
    return true;
  }
  if (normalizeDose(value) && normalizedTranscript.replace(/\s+/g, "").includes(normalizeDose(value))) {
    return true;
  }
  if (normalizeFrequency(value) && normalizedTranscript.replace(/\s+/g, "").includes(normalizeFrequency(value))) {
    return true;
  }

  const valueTokens = tokens(value).filter((token) => token.length > 2);
  if (valueTokens.length > 0 && valueTokens.every((token) => normalizedTranscript.includes(token))) {
    return true;
  }

  const transcriptTokens = tokens(transcript);
  const windowSize = Math.max(1, valueTokens.length + 2);
  for (let index = 0; index < transcriptTokens.length; index += 1) {
    const window = transcriptTokens.slice(index, index + windowSize).join(" ");
    if (tokenSetRatio(value, window) >= 0.84) {
      return true;
    }
  }

  return false;
}

export function detectHallucinations(prediction: unknown, transcript: string): HallucinationFinding[] {
  return collectScalarValues(prediction)
    .filter(({ field }) => !field.endsWith(".icd10"))
    .filter(({ value }) => !hasGrounding(value, transcript))
    .map(({ field, value }) => ({
      field,
      value,
      reason: "Value was not found as an exact substring or close fuzzy match in the transcript.",
    }));
}

export function evaluateExtraction(params: {
  transcript: string;
  prediction: unknown;
  gold: ClinicalExtraction;
  schemaValid?: boolean;
}): EvaluationResult {
  const predicted = asRecord(params.prediction);
  const validation = validateExtraction(params.prediction);
  const predictedVitals = asRecord(predicted.vitals);
  const predictedFollowUp = asRecord(predicted.follow_up);
  const predictedMedications = asArray<Record<string, unknown>>(predicted.medications);
  const predictedDiagnoses = asArray<Record<string, unknown>>(predicted.diagnoses);
  const predictedPlan = asArray<string>(predicted.plan).map(String);
  const medicationScore = scoreSet(predictedMedications, params.gold.medications, medicationMatches);
  const planScore = scoreSet(predictedPlan, params.gold.plan, (predictedItem, goldItem) => tokenSetRatio(predictedItem, goldItem) >= 0.72);

  const scores: FieldScores = {
    chief_complaint: tokenSetRatio(predicted.chief_complaint as Scalar, params.gold.chief_complaint),
    vitals: scoreVitals(predictedVitals, params.gold.vitals),
    medications: medicationScore.f1,
    diagnoses: diagnosisScore(predictedDiagnoses, params.gold.diagnoses),
    plan: planScore.f1,
    follow_up: scoreFollowUp(predictedFollowUp, params.gold.follow_up),
    overall: 0,
  };
  scores.overall = FIELD_KEYS.reduce((sum, field) => sum + scores[field], 0) / FIELD_KEYS.length;

  return {
    scores,
    schemaValid: params.schemaValid ?? validation.valid,
    schemaErrors: validation.errors,
    hallucinations: detectHallucinations(params.prediction, params.transcript),
    details: {
      medication: medicationScore,
      plan: planScore,
    },
  };
}
