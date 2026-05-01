import type { PromptStrategyId, RunRecord } from "@test-evals/shared";

import { EvalRunner } from "../services/runner.service";

function parseArgs(argv: string[]): {
  strategy: PromptStrategyId;
  model: string;
  filter?: string[];
  transcriptId?: string;
  provider?: "anthropic" | "fixture";
  force: boolean;
} {
  const args = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, value] = arg.slice(2).split("=");
    if (key) {
      args.set(key, value ?? true);
    }
  }

  const strategy = String(args.get("strategy") ?? "zero_shot") as PromptStrategyId;
  if (!["zero_shot", "few_shot", "cot"].includes(strategy)) {
    throw new Error("--strategy must be one of zero_shot, few_shot, cot");
  }

  const filterValue = args.get("filter");
  const transcriptValue = args.get("transcript_id") ?? args.get("case");

  return {
    strategy,
    model: String(args.get("model") ?? "claude-haiku-4-5-20251001"),
    filter: typeof filterValue === "string" ? filterValue.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    transcriptId: typeof transcriptValue === "string" ? transcriptValue : undefined,
    provider: args.get("provider") === "fixture" ? "fixture" : args.get("provider") === "anthropic" ? "anthropic" : undefined,
    force: args.get("force") === true || args.get("force") === "true",
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printRunSummary(run: RunRecord): void {
  const rows: Array<[string, string]> = [
    ["Run", run.id],
    ["Status", run.status],
    ["Strategy", run.strategy],
    ["Model", run.model],
    ["Prompt hash", run.promptHash],
    ["Cases", `${run.aggregate.completedCases}/${run.aggregate.totalCases}`],
    ["Overall", formatPct(run.aggregate.aggregateF1)],
    ["Chief complaint", formatPct(run.aggregate.perField.chief_complaint)],
    ["Vitals", formatPct(run.aggregate.perField.vitals)],
    ["Medications", formatPct(run.aggregate.perField.medications)],
    ["Diagnoses", formatPct(run.aggregate.perField.diagnoses)],
    ["Plan", formatPct(run.aggregate.perField.plan)],
    ["Follow-up", formatPct(run.aggregate.perField.follow_up)],
    ["Hallucinations", String(run.aggregate.hallucinationCount)],
    ["Schema failures", String(run.aggregate.schemaFailureCount)],
    ["Input tokens", String(run.aggregate.usage.inputTokens)],
    ["Output tokens", String(run.aggregate.usage.outputTokens)],
    ["Cache read tokens", String(run.aggregate.usage.cacheReadInputTokens)],
    ["Cache write tokens", String(run.aggregate.usage.cacheCreationInputTokens)],
    ["Cost", `$${run.aggregate.costUsd.toFixed(4)}`],
    ["Duration", `${(run.aggregate.durationMs / 1000).toFixed(1)}s`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));

  console.log("\nHEALOSBENCH eval summary");
  console.log("========================");
  for (const [label, value] of rows) {
    console.log(`${label.padEnd(width)}  ${value}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.provider) {
    process.env.LLM_PROVIDER = args.provider;
  }
  const runner = new EvalRunner();
  const run = await runner.runToCompletion({
    strategy: args.strategy,
    model: args.model,
    dataset_filter: args.filter,
    transcript_id: args.transcriptId,
    force: args.force,
  });

  printRunSummary(run);

  if (run.status === "failed") {
    const errors = run.cases.filter((caseResult) => caseResult.error);
    for (const caseResult of errors) {
      console.error(`${caseResult.transcriptId}: ${caseResult.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
