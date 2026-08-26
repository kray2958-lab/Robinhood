export class RobinhoodError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly actionable?: string,
  ) {
    super(message);
    this.name = "RobinhoodError";
  }
}

export class AuthenticationError extends RobinhoodError {
  constructor(message: string, actionable?: string) {
    super(message, "AUTHENTICATION_FAILED", 401, actionable);
    this.name = "AuthenticationError";
  }
}

export class InsufficientFundsError extends RobinhoodError {
  constructor(required: number, available: number) {
    super(
      `Insufficient buying power. Required: $${required.toFixed(2)}, available: $${available.toFixed(2)}`,
      "INSUFFICIENT_FUNDS",
      400,
      "Reduce order size or add funds to your account.",
    );
    this.name = "InsufficientFundsError";
  }
}

export class InsufficientSharesError extends RobinhoodError {
  constructor(symbol: string, requested: number, available: number) {
    super(
      `Insufficient shares of ${symbol}. Requested: ${requested}, available: ${available}`,
      "INSUFFICIENT_SHARES",
      400,
      "Reduce sell quantity or check your current position.",
    );
    this.name = "InsufficientSharesError";
  }
}

export class InvalidSymbolError extends RobinhoodError {
  constructor(symbol: string) {
    super(
      `Invalid or unknown symbol: ${symbol}`,
      "INVALID_SYMBOL",
      400,
      "Verify the ticker symbol and try again.",
    );
    this.name = "InvalidSymbolError";
  }
}

export class MarketClosedError extends RobinhoodError {
  constructor() {
    super(
      "Market is currently closed for this order type.",
      "MARKET_CLOSED",
      400,
      "Place a limit order or wait for market hours.",
    );
    this.name = "MarketClosedError";
  }
}

export class RateLimitError extends RobinhoodError {
  constructor(retryAfterSeconds?: number) {
    super(
      `Rate limit exceeded${retryAfterSeconds ? `. Retry after ${retryAfterSeconds}s` : ""}`,
      "RATE_LIMITED",
      429,
      "Wait before making additional requests.",
    );
    this.name = "RateLimitError";
  }
}

export class NetworkError extends RobinhoodError {
  constructor(cause?: unknown) {
    super(
      "Network request to Robinhood failed.",
      "NETWORK_ERROR",
      undefined,
      "Check your connection and try again.",
    );
    this.name = "NetworkError";
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export function formatErrorForMcp(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (error instanceof RobinhoodError) {
    const parts = [`Error [${error.code}]: ${error.message}`];
    if (error.actionable) {
      parts.push(`Suggestion: ${error.actionable}`);
    }
    return {
      content: [{ type: "text", text: parts.join("\n") }],
      isError: true,
    };
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
