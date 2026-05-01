import type { CompareRunResult, FieldScores } from "@test-evals/shared";

import { getRun } from "./store.service";

const FIELDS: Array<keyof FieldScores> = [
  "chief_complaint",
  "vitals",
  "medications",
  "diagnoses",
  "plan",
  "follow_up",
  "overall",
];

export async function compareRuns(leftId: string, rightId: string): Promise<CompareRunResult> {
  const [left, right] = await Promise.all([getRun(leftId), getRun(rightId)]);
  if (!left || !right) {
    throw new Error("Both runs are required for comparison.");
  }

  return {
    left,
    right,
    fields: FIELDS.map((field) => {
      const leftScore = left.aggregate.perField[field];
      const rightScore = right.aggregate.perField[field];
      const delta = rightScore - leftScore;

      return {
        field,
        left: leftScore,
        right: rightScore,
        delta,
        winner: Math.abs(delta) < 0.001 ? "tie" : delta > 0 ? "right" : "left",
      };
    }),
  };
}
