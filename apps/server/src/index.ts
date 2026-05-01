import { env } from "@test-evals/env/server";
import type { PromptStrategyId, StartRunRequest } from "@test-evals/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { compareRuns } from "./services/compare.service";
import { runEvents, type RunEvent } from "./services/events.service";
import { evalRunner } from "./services/runner.service";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
  const { auth } = await import("@test-evals/auth");
  return auth.handler(c.req.raw);
});

app.get("/", (c) => {
  return c.text("OK");
});

app.get("/api/v1/runs", async (c) => {
  return c.json(await evalRunner.listRuns());
});

app.get("/api/v1/runs/:id", async (c) => {
  const run = await evalRunner.getRun(c.req.param("id"));
  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  return c.json(run);
});

app.post("/api/v1/runs", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<StartRunRequest>;
  const strategy = body.strategy as PromptStrategyId | undefined;
  if (!strategy || !["zero_shot", "few_shot", "cot"].includes(strategy)) {
    return c.json({ error: "strategy must be one of zero_shot, few_shot, cot" }, 400);
  }

  const run = await evalRunner.createAndStart({
    strategy,
    model: body.model ?? "claude-haiku-4-5-20251001",
    dataset_filter: body.transcript_id ? [body.transcript_id] : body.dataset_filter,
    transcript_id: body.transcript_id,
    force: Boolean(body.force),
  });

  return c.json(run, 202);
});

app.post("/api/v1/runs/:id/resume", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const run = await evalRunner.resume(c.req.param("id"), Boolean(body.force));

  return c.json(run);
});

app.get("/api/v1/runs/:id/events", async (c) => {
  const runId = c.req.param("id");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RunEvent | { type: "snapshot"; run: unknown }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const unsubscribe = runEvents.subscribe(runId, send);
      const currentRun = await evalRunner.getRun(runId);
      send({ type: "snapshot", run: currentRun });
      c.req.raw.signal.addEventListener("abort", () => {
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.get("/api/v1/compare", async (c) => {
  const left = c.req.query("left");
  const right = c.req.query("right");
  if (!left || !right) {
    return c.json({ error: "left and right query parameters are required" }, 400);
  }

  return c.json(await compareRuns(left, right));
});

export default {
  port: Number(process.env.PORT ?? 8787),
  fetch: app.fetch,
};
