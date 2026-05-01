import { index, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const evalRun = pgTable(
  "eval_run",
  {
    id: text("id").primaryKey(),
    strategy: text("strategy").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    promptHash: text("prompt_hash").notNull(),
    aggregateF1: numeric("aggregate_f1").notNull().default("0"),
    hallucinationCount: integer("hallucination_count").notNull().default(0),
    schemaFailureCount: integer("schema_failure_count").notNull().default(0),
    costUsd: numeric("cost_usd").notNull().default("0"),
    usage: jsonb("usage").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [index("eval_run_strategy_model_idx").on(table.strategy, table.model)],
);

export const evalCaseResult = pgTable(
  "eval_case_result",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRun.id, { onDelete: "cascade" }),
    transcriptId: text("transcript_id").notNull(),
    status: text("status").notNull(),
    prediction: jsonb("prediction"),
    evaluation: jsonb("evaluation"),
    trace: jsonb("trace").notNull(),
    costUsd: numeric("cost_usd").notNull().default("0"),
    wallTimeMs: integer("wall_time_ms").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("eval_case_run_idx").on(table.runId),
    index("eval_case_idempotency_idx").on(table.transcriptId),
  ],
);
