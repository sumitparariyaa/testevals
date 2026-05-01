import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/healosbench"),
    BETTER_AUTH_SECRET: z.string().min(32).default("dev-secret-change-me-dev-secret-change-me"),
    BETTER_AUTH_URL: z.url().default("http://localhost:8787"),
    CORS_ORIGIN: z.url().default("http://localhost:3001"),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    LLM_PROVIDER: z.enum(["anthropic", "fixture"]).default("anthropic"),
    EVAL_STORE_DIR: z.string().min(1).default("results"),
    MAX_RUN_COST_USD: z.coerce.number().positive().default(5),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
