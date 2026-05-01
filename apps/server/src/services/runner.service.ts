import type { CaseResult, RunRecord, StartRunRequest } from "@test-evals/shared";

import { loadDataset, loadDatasetCase } from "./dataset.service";
import { evaluateExtraction } from "./evaluate.service";
import { runEvents } from "./events.service";
import { createRun, getCachedCase, getRun, listRuns, setCachedCase, updateRun } from "./store.service";
import { withRateLimitBackoff } from "./rate-limit.service";
import { createExtractor, estimateCostUsd, type Extractor } from "./extract.service";

export interface RunnerOptions {
  extractor?: Extractor;
  concurrency?: number;
  backoffBaseDelayMs?: number;
}

export class EvalRunner {
  private readonly extractor: Extractor;
  private readonly concurrency: number;
  private readonly backoffBaseDelayMs: number;
  private readonly activeRuns = new Map<string, Promise<RunRecord>>();

  constructor(options: RunnerOptions = {}) {
    this.extractor = options.extractor ?? createExtractor();
    this.concurrency = options.concurrency ?? 5;
    this.backoffBaseDelayMs = options.backoffBaseDelayMs ?? 750;
  }

  async createAndStart(request: StartRunRequest): Promise<RunRecord> {
    const dataset = request.transcript_id ? [] : await loadDataset(request.dataset_filter);
    const transcriptIds = request.transcript_id ? [request.transcript_id] : dataset.map((item) => item.id);
    const run = await createRun(request, transcriptIds);
    void this.resume(run.id, Boolean(request.force));

    return run;
  }

  async runToCompletion(request: StartRunRequest): Promise<RunRecord> {
    const dataset = request.transcript_id ? [] : await loadDataset(request.dataset_filter);
    const transcriptIds = request.transcript_id ? [request.transcript_id] : dataset.map((item) => item.id);
    const run = await createRun(request, transcriptIds);

    return this.resume(run.id, Boolean(request.force));
  }

  async resume(id: string, force = false): Promise<RunRecord> {
    const active = this.activeRuns.get(id);
    if (active) {
      return active;
    }

    const promise = this.processRun(id, force).finally(() => {
      this.activeRuns.delete(id);
    });
    this.activeRuns.set(id, promise);

    return promise;
  }

  async getRun(id: string): Promise<RunRecord | null> {
    return getRun(id);
  }

  async listRuns(): Promise<RunRecord[]> {
    return listRuns();
  }

  private async processRun(id: string, force: boolean): Promise<RunRecord> {
    const existing = await getRun(id);
    if (!existing) {
      throw new Error(`Run not found: ${id}`);
    }

    let run = await updateRun(existing.id, (current) => ({
      ...current,
      status: "running",
      startedAt: current.startedAt ?? new Date().toISOString(),
    }));
    runEvents.publish(run.id, { type: "run_started", run });

    const queue = run.cases
      .filter((caseResult) => caseResult.status !== "completed")
      .map((caseResult) => caseResult.transcriptId);
    const workers = Array.from({ length: Math.min(this.concurrency, Math.max(1, queue.length)) }, async () => {
      while (queue.length > 0) {
        const transcriptId = queue.shift();
        if (!transcriptId) {
          return;
        }
        await this.processCase(run.id, transcriptId, force);
      }
    });

    await Promise.all(workers);
    const finished = await getRun(run.id);
    if (!finished) {
      throw new Error(`Run disappeared: ${run.id}`);
    }

    const hasFailedCase = finished.cases.some((caseResult) => caseResult.status === "failed");
    run = await updateRun(finished.id, (current) => ({
      ...current,
      status: hasFailedCase ? "failed" : "completed",
      completedAt: new Date().toISOString(),
    }));
    if (hasFailedCase) {
      runEvents.publish(run.id, { type: "run_failed", run, error: "One or more cases failed." });
    } else {
      runEvents.publish(run.id, { type: "run_completed", run });
    }

    return run;
  }

  private async processCase(runId: string, transcriptId: string, force: boolean): Promise<void> {
    let skipped = false;
    let run = await updateRun(runId, (current) => {
      const caseIndex = current.cases.findIndex((caseResult) => caseResult.transcriptId === transcriptId);
      if (caseIndex < 0) {
        throw new Error(`Case ${transcriptId} is not part of run ${runId}`);
      }

      const startingCase = current.cases[caseIndex];
      if (!startingCase) {
        throw new Error(`Case ${transcriptId} is missing from run ${runId}`);
      }
      if (startingCase.status === "completed") {
        skipped = true;
        return current;
      }

      current.cases[caseIndex] = { ...startingCase, transcriptId, status: "running" };
      return current;
    });
    if (skipped) {
      return;
    }

    try {
      const datasetCase = await loadDatasetCase(transcriptId);
      const cacheInput = {
        strategy: run.strategy,
        model: run.model,
        transcriptId,
        promptHash: run.promptHash,
      };
      const cached = force ? null : await getCachedCase(cacheInput);
      const result = cached ?? (await this.extractAndEvaluate(run, datasetCase));
      const completedResult: CaseResult = {
        ...result,
        transcriptId,
        transcript: datasetCase.transcript,
        gold: datasetCase.gold,
        status: "completed",
        completedAt: new Date().toISOString(),
      };

      if (!cached) {
        await setCachedCase(cacheInput, completedResult);
      }

      const saved = await updateRun(runId, (latest) => {
        const latestIndex = latest.cases.findIndex((caseResult) => caseResult.transcriptId === transcriptId);
        if (latestIndex < 0) {
          throw new Error(`Case ${transcriptId} is not part of run ${runId}`);
        }
        latest.cases[latestIndex] = completedResult;
        return latest;
      });
      runEvents.publish(runId, { type: "case_completed", run: saved, transcriptId });
    } catch (error) {
      const failedResult: CaseResult = {
        transcriptId,
        status: "failed",
        trace: [],
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        costUsd: 0,
        wallTimeMs: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      const saved = await updateRun(runId, (latest) => {
        const latestIndex = latest.cases.findIndex((caseResult) => caseResult.transcriptId === transcriptId);
        if (latestIndex < 0) {
          throw new Error(`Case ${transcriptId} is not part of run ${runId}`);
        }
        latest.cases[latestIndex] = failedResult;
        return latest;
      });
      runEvents.publish(runId, { type: "case_failed", run: saved, transcriptId, error: failedResult.error ?? "Unknown error" });
    }
  }

  private async extractAndEvaluate(run: RunRecord, datasetCase: Awaited<ReturnType<typeof loadDatasetCase>>): Promise<CaseResult> {
    const extraction = await withRateLimitBackoff(
      () =>
        this.extractor.extract({
          transcript: datasetCase.transcript,
          transcriptId: datasetCase.id,
          strategy: run.strategy,
          model: run.model,
        }),
      { baseDelayMs: this.backoffBaseDelayMs },
    );
    const evaluation = evaluateExtraction({
      transcript: datasetCase.transcript,
      prediction: extraction.prediction,
      gold: datasetCase.gold,
      schemaValid: extraction.schemaValid,
    });
    const costUsd = this.extractor.estimateCost?.(run.model, extraction.usage) ?? estimateCostUsd(run.model, extraction.usage);

    return {
      transcriptId: datasetCase.id,
      status: "completed",
      prediction: extraction.prediction,
      evaluation,
      trace: extraction.attempts,
      promptHash: extraction.promptHash,
      usage: extraction.usage,
      costUsd,
      wallTimeMs: extraction.wallTimeMs,
    };
  }
}

export const evalRunner = new EvalRunner();
