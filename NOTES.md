# HEALOSBENCH Notes

## What shipped

- Anthropic tool-use extractor with three prompt strategies: `zero_shot`, `few_shot`, and `cot`.
- Server extraction boundary at `apps/server/src/services/extract.service.ts`; production uses Anthropic, and `LLM_PROVIDER=fixture` is only for local smoke tests without an API key.
- JSON Schema validation via AJV 2020, retry-with-error-feedback capped at 3 attempts, and full attempt traces.
- Prompt caching on the system prompt/few-shot block, with cache read/write token counts surfaced per attempt and per run.
- Per-field evaluator: fuzzy chief complaint, tolerant vitals, set-F1 medications/diagnoses/plan, follow-up interval plus fuzzy reason.
- Simple hallucination detector that checks predicted scalar values against the transcript with exact substring, normalization, and fuzzy windows.
- Resumable/idempotent runner with durable run files under `results/`, concurrency capped at 5, SSE progress, and cached case results.
- Dashboard with run list, run detail, grounded transcript highlights, gold/predicted JSON, LLM trace, and per-field compare deltas.
- CLI: `bun run eval -- --strategy=zero_shot --model=claude-haiku-4-5-20251001`.

## Rate limits and 429s

The runner never fans out all cases at once. It uses up to 5 workers and wraps each Anthropic call in exponential backoff for 429-style errors. Backoff starts at 750 ms and doubles up to 4 retries. If retries are exhausted, only that case is marked failed; completed cases remain persisted, so `POST /api/v1/runs/:id/resume` continues from the remaining cases without double-charging completed calls.

## Results

This workstation did not have `ANTHROPIC_API_KEY` configured, so I did not run the real 50-case, 3-strategy Anthropic eval. Verification completed locally:

| Check | Result |
| --- | --- |
| `bun install` | pass |
| `bun test` | 9 tests passing |
| `bun run check-types` | pass |
| `bun run build` | pass |

After setting `apps/server/.env`, run:

```sh
bun run eval -- --strategy=zero_shot
bun run eval -- --strategy=few_shot
bun run eval -- --strategy=cot
```

The runs will be written to `results/runs/` and visible in the dashboard compare view.

For local smoke testing without calling Anthropic:

```sh
bun run eval -- --strategy=zero_shot --provider=fixture --case=case_001
```

## What surprised me

The synthetic transcripts are regular enough that vitals can be scored very cleanly, but medications need aggressive normalization. `BID`, `twice daily`, `q6h`, and `every 6 hours` are common places where exact string scoring would badly understate quality.

## What I would build next

- Postgres-backed persistence as the primary store, keeping JSON run files as portable artifacts.
- Prompt diff/regression view for two prompt hashes.
- Cost guardrail based on sampled token estimates before starting a full run.
- Active-learning panel showing cases where two strategies disagree most.

## What I cut

Auth routes and UI scaffolding are still present, but auth is not required for the eval dashboard because the assessment explicitly says better-auth is not required for this task. The Drizzle eval schema exists, but the runner currently persists to durable JSON files so the harness works even without local Postgres running.
