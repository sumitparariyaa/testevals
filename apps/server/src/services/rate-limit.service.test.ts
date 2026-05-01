import { describe, expect, test } from "bun:test";

import { withRateLimitBackoff } from "./rate-limit.service";

describe("withRateLimitBackoff", () => {
  test("backs off and retries 429s", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRateLimitBackoff(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw { status: 429 };
        }
        return "ok";
      },
      { baseDelayMs: 5, sleep: async (ms) => void delays.push(ms) },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(delays).toEqual([5]);
  });
});
