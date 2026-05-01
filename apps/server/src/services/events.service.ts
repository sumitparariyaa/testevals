import type { RunRecord } from "@test-evals/shared";

export type RunEvent =
  | { type: "run_started"; run: RunRecord }
  | { type: "case_completed"; run: RunRecord; transcriptId: string }
  | { type: "case_failed"; run: RunRecord; transcriptId: string; error: string }
  | { type: "run_completed"; run: RunRecord }
  | { type: "run_failed"; run: RunRecord; error: string };

type Listener = (event: RunEvent) => void;

class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  publish(runId: string, event: RunEvent): void {
    for (const listener of this.listeners.get(runId) ?? []) {
      listener(event);
    }
  }
}

export const runEvents = new RunEventBus();
