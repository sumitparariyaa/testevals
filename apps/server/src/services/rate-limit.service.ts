export interface BackoffOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  return record.status === 429 || record.statusCode === 429 || record.code === "rate_limit_error";
}

export async function withRateLimitBackoff<T>(fn: () => Promise<T>, options: BackoffOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 750;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelayMs * 2 ** attempt;
      await sleep(delay);
    }
  }

  throw new Error("Rate limit backoff exhausted.");
}
