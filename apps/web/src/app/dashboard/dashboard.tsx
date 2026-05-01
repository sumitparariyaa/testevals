"use client";

import type { CaseResult, CompareRunResult, PromptStrategyId, RunRecord } from "@test-evals/shared";
import { Activity, GitCompare, Play, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8787";
const STRATEGIES: PromptStrategyId[] = ["zero_shot", "few_shot", "cot"];

function formatPct(value = 0): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value = 0): string {
  return `$${value.toFixed(4)}`;
}

function formatDuration(ms = 0): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;

  return minutes > 0 ? `${minutes}m ${remainder}s` : `${seconds}s`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

function collectHighlights(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text.length > 2 ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectHighlights);
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap(collectHighlights);
  }

  return [];
}

function flattenJson(value: unknown, prefix = ""): Array<{ path: string; value: unknown }> {
  if (value == null || typeof value !== "object") {
    return [{ path: prefix || "$", value }];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [{ path: prefix || "$", value: [] }];
    }

    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`));
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [{ path: prefix || "$", value: {} }];
  }

  return entries.flatMap(([key, nested]) => flattenJson(nested, prefix ? `${prefix}.${key}` : key));
}

function buildFieldDiff(gold: unknown, prediction: unknown) {
  const goldMap = new Map(flattenJson(gold).map((entry) => [entry.path, entry.value]));
  const predictionMap = new Map(flattenJson(prediction).map((entry) => [entry.path, entry.value]));
  const paths = [...new Set([...goldMap.keys(), ...predictionMap.keys()])].sort();

  return paths.map((path) => {
    const goldValue = goldMap.get(path);
    const predictedValue = predictionMap.get(path);
    const matches = JSON.stringify(goldValue) === JSON.stringify(predictedValue);

    return { path, goldValue, predictedValue, matches };
  });
}

function HighlightedTranscript({ transcript, prediction }: { transcript: string; prediction: unknown }) {
  const ranges = useMemo(() => {
    const candidates = [...new Set(collectHighlights(prediction))]
      .sort((left, right) => right.length - left.length)
      .slice(0, 80);
    const lower = transcript.toLowerCase();
    const found: Array<{ start: number; end: number }> = [];

    for (const candidate of candidates) {
      const needle = candidate.toLowerCase();
      const start = lower.indexOf(needle);
      if (start >= 0 && !found.some((range) => start < range.end && start + candidate.length > range.start)) {
        found.push({ start, end: start + candidate.length });
      }
    }

    return found.sort((left, right) => left.start - right.start);
  }, [prediction, transcript]);

  if (ranges.length === 0) {
    return <pre className="whitespace-pre-wrap text-sm leading-6">{transcript}</pre>;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(<span key={`plain-${index}`}>{transcript.slice(cursor, range.start)}</span>);
    }
    parts.push(
      <mark key={`mark-${index}`} className="rounded-sm bg-emerald-100 px-0.5 text-emerald-950 dark:bg-emerald-500/25 dark:text-emerald-50">
        {transcript.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  parts.push(<span key="tail">{transcript.slice(cursor)}</span>);

  return <pre className="whitespace-pre-wrap text-sm leading-6">{parts}</pre>;
}

function StatusPill({ status }: { status: RunRecord["status"] | CaseResult["status"] }) {
  const className =
    status === "completed"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
      : status === "failed"
        ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-200"
        : status === "running"
          ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200";

  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>{status}</span>;
}

export default function Dashboard() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [strategy, setStrategy] = useState<PromptStrategyId>("zero_shot");
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [compare, setCompare] = useState<CompareRunResult | null>(null);
  const [error, setError] = useState("");

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];
  const selectedCase = selectedRun?.cases.find((caseResult) => caseResult.transcriptId === selectedCaseId) ?? selectedRun?.cases[0];

  const refreshRuns = async () => {
    const nextRuns = await fetchJson<RunRecord[]>("/api/v1/runs");
    setRuns(nextRuns);
    setSelectedRunId((current) => current || nextRuns[0]?.id || "");
  };

  useEffect(() => {
    refreshRuns().catch((refreshError) => setError(refreshError instanceof Error ? refreshError.message : String(refreshError)));
    const timer = window.setInterval(() => {
      refreshRuns().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedRun?.id || selectedRun.status !== "running") {
      return;
    }

    const events = new EventSource(`${API_URL}/api/v1/runs/${selectedRun.id}/events`);
    events.onmessage = (message) => {
      const event = JSON.parse(message.data) as { run?: RunRecord };
      if (event.run) {
        setRuns((current) => [event.run as RunRecord, ...current.filter((run) => run.id !== event.run?.id)]);
      }
    };

    return () => events.close();
  }, [selectedRun?.id, selectedRun?.status]);

  useEffect(() => {
    if (!compareLeft || !compareRight || compareLeft === compareRight) {
      setCompare(null);
      return;
    }

    fetchJson<CompareRunResult>(`/api/v1/compare?left=${compareLeft}&right=${compareRight}`)
      .then(setCompare)
      .catch((compareError) => setError(compareError instanceof Error ? compareError.message : String(compareError)));
  }, [compareLeft, compareRight]);

  const startRun = async () => {
    setError("");
    const run = await fetchJson<RunRecord>("/api/v1/runs", {
      method: "POST",
      body: JSON.stringify({ strategy, model }),
    });
    setRuns((current) => [run, ...current]);
    setSelectedRunId(run.id);
  };

  const resumeRun = async () => {
    if (!selectedRun) {
      return;
    }
    const run = await fetchJson<RunRecord>(`/api/v1/runs/${selectedRun.id}/resume`, { method: "POST", body: "{}" });
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
  };

  return (
    <main className="min-h-0 overflow-auto bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6">
        <section className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Activity className="h-4 w-4" />
              HEALOSBENCH
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Clinical Extraction Eval Harness</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as PromptStrategyId)} className="h-9 rounded-md border bg-background px-3 text-sm">
              {STRATEGIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <input value={model} onChange={(event) => setModel(event.target.value)} className="h-9 min-w-72 rounded-md border bg-background px-3 text-sm" />
            <button onClick={startRun} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background">
              <Play className="h-4 w-4" />
              Start
            </button>
            <button onClick={refreshRuns} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium">
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </section>

        {error ? <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{error}</div> : null}

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Runs</h2>
              {selectedRun ? (
                <button onClick={resumeRun} className="inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs font-medium">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Resume
                </button>
              ) : null}
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Strategy</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Cost</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => {
                        setSelectedRunId(run.id);
                        setSelectedCaseId("");
                      }}
                      className={`cursor-pointer border-t hover:bg-muted/60 ${selectedRun?.id === run.id ? "bg-sky-500/10" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{run.id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{run.strategy}</td>
                      <td className="px-3 py-2">{formatPct(run.aggregate.aggregateF1)}</td>
                      <td className="px-3 py-2">{formatUsd(run.aggregate.costUsd)}</td>
                      <td className="px-3 py-2">{formatDuration(run.aggregate.durationMs)}</td>
                      <td className="px-3 py-2"><StatusPill status={run.status} /></td>
                    </tr>
                  ))}
                  {runs.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                        No runs yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-3 flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-sky-600" />
              <h2 className="text-sm font-semibold">Compare</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">Left run</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.strategy} {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <select value={compareRight} onChange={(event) => setCompareRight(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                <option value="">Right run</option>
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.strategy} {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            {compare ? (
              <div className="mt-3 divide-y rounded-md border">
                {compare.fields.map((field) => (
                  <div key={field.field} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-medium">{field.field}</span>
                    <span>{formatPct(field.left)}</span>
                    <span>{formatPct(field.right)}</span>
                    <span className={field.winner === "right" ? "text-emerald-600" : field.winner === "left" ? "text-amber-600" : "text-muted-foreground"}>
                      {field.winner === "tie" ? "tie" : `${field.delta > 0 ? "+" : ""}${formatPct(field.delta)}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {selectedRun ? (
          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="overflow-hidden rounded-md border">
              <div className="border-b px-3 py-2">
                <h2 className="text-sm font-semibold">Run Detail</h2>
                <p className="text-xs text-muted-foreground">
                  {selectedRun.model} - hash {selectedRun.promptHash} - cache read {selectedRun.aggregate.usage.cacheReadInputTokens}
                </p>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Case</th>
                      <th className="px-3 py-2">Overall</th>
                      <th className="px-3 py-2">Meds</th>
                      <th className="px-3 py-2">Halluc.</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRun.cases.map((caseResult) => (
                      <tr
                        key={caseResult.transcriptId}
                        onClick={() => setSelectedCaseId(caseResult.transcriptId)}
                        className={`cursor-pointer border-t hover:bg-muted/60 ${selectedCase?.transcriptId === caseResult.transcriptId ? "bg-emerald-500/10" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{caseResult.transcriptId}</td>
                        <td className="px-3 py-2">{formatPct(caseResult.evaluation?.scores.overall)}</td>
                        <td className="px-3 py-2">{formatPct(caseResult.evaluation?.scores.medications)}</td>
                        <td className="px-3 py-2">{caseResult.evaluation?.hallucinations.length ?? 0}</td>
                        <td className="px-3 py-2"><StatusPill status={caseResult.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedCase ? (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-md border p-3">
                  <h2 className="mb-2 text-sm font-semibold">{selectedCase.transcriptId}</h2>
                  <HighlightedTranscript transcript={selectedCase.transcript ?? ""} prediction={selectedCase.prediction} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Gold JSON</h3>
                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selectedCase.gold, null, 2)}</pre>
                  </div>
                  <div className="rounded-md border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Predicted JSON</h3>
                    <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selectedCase.prediction, null, 2)}</pre>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-semibold">Field Diff</h3>
                  <div className="max-h-80 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Field</th>
                          <th className="px-3 py-2">Gold</th>
                          <th className="px-3 py-2">Prediction</th>
                          <th className="px-3 py-2">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buildFieldDiff(selectedCase.gold, selectedCase.prediction).map((row) => (
                          <tr key={row.path} className={row.matches ? "border-t" : "border-t bg-amber-500/10"}>
                            <td className="px-3 py-2 font-mono text-xs">{row.path}</td>
                            <td className="px-3 py-2 font-mono text-xs">{JSON.stringify(row.goldValue)}</td>
                            <td className="px-3 py-2 font-mono text-xs">{JSON.stringify(row.predictedValue)}</td>
                            <td className="px-3 py-2">{row.matches ? "yes" : "no"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <h3 className="mb-2 text-sm font-semibold">LLM Trace</h3>
                  <div className="grid gap-2">
                    {selectedCase.trace.map((attempt) => (
                      <details key={attempt.attempt} className="rounded-md border p-2">
                        <summary className="cursor-pointer text-sm">
                          Attempt {attempt.attempt} - schema {attempt.schemaValid ? "valid" : "invalid"} - cache read {attempt.usage.cacheReadInputTokens}
                        </summary>
                        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(attempt, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
