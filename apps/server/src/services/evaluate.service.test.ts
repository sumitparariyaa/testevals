import { describe, expect, test } from "bun:test";

import { detectHallucinations, evaluateExtraction, normalizeDose, normalizeFrequency, scoreSet } from "./evaluate.service";

const gold = {
  chief_complaint: "sore throat",
  vitals: { bp: "122/78", hr: 84, temp_f: 99.1, spo2: 98 },
  medications: [{ name: "acetaminophen", dose: "500 mg", frequency: "every 6 hours", route: "PO" }],
  diagnoses: [{ description: "viral upper respiratory infection", icd10: "J06.9" }],
  plan: ["drink fluids", "rest"],
  follow_up: { interval_days: 7, reason: "not improving" },
};

describe("evaluate.service", () => {
  test("normalizes fuzzy medication dose and frequency", () => {
    expect(normalizeDose("500 milligrams")).toBe("500mg");
    expect(normalizeFrequency("twice daily")).toBe("bid");

    const result = evaluateExtraction({
      transcript: "Take acetaminophen 500 mg by mouth every 6 hours for sore throat. BP 122/78 HR 84 temp 99.1 SpO2 98. Viral upper respiratory infection. Drink fluids and rest. Follow up in 7 days if not improving.",
      gold,
      prediction: {
        ...gold,
        medications: [{ name: "Acetaminophen", dose: "500mg", frequency: "q6h", route: "oral" }],
      },
    });

    expect(result.scores.medications).toBe(1);
  });

  test("computes set F1 on a tiny synthetic case", () => {
    const score = scoreSet(["a", "b"], ["b", "c"], (left, right) => left === right);

    expect(score.precision).toBe(0.5);
    expect(score.recall).toBe(0.5);
    expect(score.f1).toBe(0.5);
  });

  test("detects hallucinated unsupported values", () => {
    const findings = detectHallucinations(
      { chief_complaint: "chest pain", plan: ["start amoxicillin"] },
      "Patient reports sore throat. Recommend fluids and rest.",
    );

    expect(findings.some((finding) => finding.value === "start amoxicillin")).toBe(true);
  });

  test("does not flag grounded values", () => {
    const findings = detectHallucinations(
      { chief_complaint: "sore throat", plan: ["drink fluids"] },
      "Patient reports sore throat. Plan is to drink fluids.",
    );

    expect(findings).toHaveLength(0);
  });
});
