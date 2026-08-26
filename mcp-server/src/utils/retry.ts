import { RateLimitError, NetworkError } from "./errors.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryableStatuses?: number[];
}

const DEFAULT_RETRYABLE = [408, 429, 500, 502, 503, 504];

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    retryableStatuses = DEFAULT_RETRYABLE,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const statusCode =
        error instanceof Object && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;

      const isRetryable =
        error instanceof NetworkError ||
        (statusCode !== undefined && retryableStatuses.includes(statusCode));

      if (!isRetryable || attempt === maxAttempts) {
        throw error;
      }

      if (statusCode === 429) {
        throw new RateLimitError();
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
