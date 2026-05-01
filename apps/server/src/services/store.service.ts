import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { env } from "@test-evals/env/server";
import { EMPTY_USAGE, addUsage, type CaseResult, type FieldScores, type RunAggregate, type RunRecord, type StartRunRequest } from "@test-evals/shared";
import { getPromptStrategy, promptHash } from "@test-evals/llm";

import { findRepoRoot } from "./paths.service";

const ZERO_SCORES: FieldScores = {
  chief_complaint: 0,
  vitals: 0,
  medications: 0,
  diagnoses: 0,
  plan: 0,
  follow_up: 0,
  overall: 0,
};
const runWriteLocks = new Map<string, Promise<unknown>>();

function storeRoot(): string {
  const configured = process.env.NODE_ENV === "test" ? "tmp/test-results" : env.EVAL_STORE_DIR;
  return resolve(findRepoRoot(), configured);
}

function runsDir(): string {
  return join(storeRoot(), "runs");
}

function cacheDir(): string {
  return join(storeRoot(), "cache");
}

async function ensureStore(): Promise<void> {
  await Promise.all([mkdir(runsDir(), { recursive: true }), mkdir(cacheDir(), { recursive: true })]);
}

function runPath(id: string): string {
  return join(runsDir(), `${id}.json`);
}

function cacheKey(input: {
  strategy: string;
  model: string;
  transcriptId: string;
  promptHash: string;
}): string {
  return createHash("sha256")
    .update(`${input.strategy}:${input.model}:${input.promptHash}:${input.transcriptId}`)
    .digest("hex");
}

function cachePath(input: {
  strategy: string;
  model: string;
  transcriptId: string;
  promptHash: string;
}): string {
  return join(cacheDir(), `${cacheKey(input)}.json`);
}

async function withRunLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = runWriteLocks.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  runWriteLocks.set(id, next);

  try {
    return await next;
  } finally {
    if (runWriteLocks.get(id) === next) {
      runWriteLocks.delete(id);
    }
  }
}

export function emptyAggregate(totalCases: number): RunAggregate {
  return {
    aggregateF1: 0,
    perField: { ...ZERO_SCORES },
    hallucinationCount: 0,
    schemaFailureCount: 0,
    usage: EMPTY_USAGE,
    costUsd: 0,
    completedCases: 0,
    totalCases,
    durationMs: 0,
  };
}

export function buildAggregate(run: RunRecord): RunAggregate {
  const completed = run.cases.filter((caseResult) => caseResult.status === "completed");
  const aggregate = emptyAggregate(run.cases.length);

  if (completed.length === 0) {
    return {
      ...aggregate,
      durationMs: (run.completedAt ? Date.parse(run.completedAt) : Date.now()) - Date.parse(run.createdAt),
    };
  }

  const fields = Object.keys(ZERO_SCORES) as Array<keyof FieldScores>;
  for (const caseResult of completed) {
    aggregate.usage = addUsage(aggregate.usage, caseResult.usage);
    aggregate.costUsd += caseResult.costUsd;
    aggregate.hallucinationCount += caseResult.evaluation?.hallucinations.length ?? 0;
    aggregate.schemaFailureCount += caseResult.evaluation?.schemaValid === false ? 1 : 0;
    for (const field of fields) {
      aggregate.perField[field] += caseResult.evaluation?.scores[field] ?? 0;
    }
  }

  for (const field of fields) {
    aggregate.perField[field] = aggregate.perField[field] / completed.length;
  }
  aggregate.aggregateF1 = aggregate.perField.overall;
  aggregate.completedCases = completed.length;
  aggregate.durationMs = (run.completedAt ? Date.parse(run.completedAt) : Date.now()) - Date.parse(run.createdAt);

  return aggregate;
}

export async function createRun(request: StartRunRequest, transcriptIds: string[]): Promise<RunRecord> {
  await ensureStore();
  const strategy = request.strategy;
  const now = new Date().toISOString();
  const hash = promptHash(getPromptStrategy(strategy));
  const id = randomUUID();
  const run: RunRecord = {
    id,
    strategy,
    model: request.model ?? "claude-haiku-4-5-20251001",
    status: "queued",
    promptHash: hash,
    datasetFilter: request.dataset_filter,
    createdAt: now,
    updatedAt: now,
    aggregate: emptyAggregate(transcriptIds.length),
    cases: transcriptIds.map((transcriptId) => ({
      transcriptId,
      status: "pending",
      trace: [],
      usage: EMPTY_USAGE,
      costUsd: 0,
      wallTimeMs: 0,
    })),
  };

  await saveRun(run);
  return run;
}

async function writeRunFile(run: RunRecord): Promise<RunRecord> {
  await ensureStore();
  const updated: RunRecord = {
    ...run,
    updatedAt: new Date().toISOString(),
    aggregate: buildAggregate(run),
  };
  const file = runPath(run.id);
  const tempFile = `${file}.${randomUUID()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(tempFile, file);

  return updated;
}

export async function saveRun(run: RunRecord): Promise<RunRecord> {
  return withRunLock(run.id, () => writeRunFile(run));
}

export async function updateRun(
  id: string,
  updater: (run: RunRecord) => RunRecord | Promise<RunRecord>,
): Promise<RunRecord> {
  return withRunLock(id, async () => {
    const run = await getRun(id);
    if (!run) {
      throw new Error(`Run not found: ${id}`);
    }

    return writeRunFile(await updater(run));
  });
}

export async function getRun(id: string): Promise<RunRecord | null> {
  await ensureStore();
  const file = runPath(id);
  if (!existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(await readFile(file, "utf8")) as RunRecord;
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureStore();
  const files = (await readdir(runsDir())).filter((file) => file.endsWith(".json"));
  const runs = (
    await Promise.all(
      files.map(async (file) => {
        try {
          return JSON.parse(await readFile(join(runsDir(), file), "utf8")) as RunRecord;
        } catch {
          return null;
        }
      }),
    )
  ).filter((run): run is RunRecord => Boolean(run));

  return runs.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function getCachedCase(input: {
  strategy: string;
  model: string;
  transcriptId: string;
  promptHash: string;
}): Promise<CaseResult | null> {
  await ensureStore();
  const file = cachePath(input);
  if (!existsSync(file)) {
    return null;
  }

  return JSON.parse(await readFile(file, "utf8")) as CaseResult;
}

export async function setCachedCase(
  input: {
    strategy: string;
    model: string;
    transcriptId: string;
    promptHash: string;
  },
  result: CaseResult,
): Promise<void> {
  await ensureStore();
  await writeFile(cachePath(input), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
