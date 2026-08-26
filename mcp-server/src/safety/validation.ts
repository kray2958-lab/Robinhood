import {
  InsufficientFundsError,
  InsufficientSharesError,
  InvalidSymbolError,
  RobinhoodError,
} from "../utils/errors.js";
import type { AccountProfile, Position } from "../types/index.js";

const TICKER_REGEX = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const CRYPTO_REGEX = /^[A-Z0-9-]{2,12}$/;

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function validateTickerSymbol(symbol: string, allowCrypto = false): string {
  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    throw new InvalidSymbolError(symbol);
  }

  if (TICKER_REGEX.test(normalized)) {
    return normalized;
  }

  if (allowCrypto && CRYPTO_REGEX.test(normalized)) {
    return normalized;
  }

  throw new InvalidSymbolError(symbol);
}

export function validatePositiveAmount(
  value: number,
  fieldName: string,
): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RobinhoodError(
      `${fieldName} must be a positive number.`,
      "INVALID_ORDER",
      400,
      `Provide a valid ${fieldName.toLowerCase()}.`,
    );
  }
  return value;
}

export function validatePositiveQuantity(quantity: number): number {
  return validatePositiveAmount(quantity, "Quantity");
}

export function validateBuyingPower(
  estimatedCost: number,
  account: AccountProfile,
): void {
  if (estimatedCost > account.buyingPower) {
    throw new InsufficientFundsError(estimatedCost, account.buyingPower);
  }
}

export function validatePositionSize(
  symbol: string,
  quantity: number,
  positions: Position[],
): void {
  const position = positions.find((p) => p.symbol === symbol);
  const available = position?.quantity ?? 0;

  if (quantity > available) {
    throw new InsufficientSharesError(symbol, quantity, available);
  }
}

export function buildTradeSummary(params: {
  symbol: string;
  side: "buy" | "sell";
  quantity?: number;
  amount?: number;
  limitPrice?: number;
  stopPrice?: number;
  orderType: string;
  currentPrice: number;
  estimatedCost: number;
  fees?: number;
  paperTrading: boolean;
}): string {
  const lines = [
    "## Trade Summary",
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| Symbol | ${params.symbol} |`,
    `| Side | ${params.side.toUpperCase()} |`,
    `| Order Type | ${params.orderType} |`,
  ];

  if (params.quantity !== undefined) {
    lines.push(`| Quantity | ${params.quantity} |`);
  }
  if (params.amount !== undefined) {
    lines.push(`| Amount | $${params.amount.toFixed(2)} |`);
  }
  if (params.limitPrice !== undefined) {
    lines.push(`| Limit Price | $${params.limitPrice.toFixed(2)} |`);
  }
  if (params.stopPrice !== undefined) {
    lines.push(`| Stop Price | $${params.stopPrice.toFixed(2)} |`);
  }

  lines.push(
    `| Current Price | $${params.currentPrice.toFixed(2)} |`,
    `| Estimated Cost | $${params.estimatedCost.toFixed(2)} |`,
  );

  if (params.fees !== undefined) {
    lines.push(`| Estimated Fees | $${params.fees.toFixed(2)} |`);
  }

  if (params.paperTrading) {
    lines.push("", "**Mode:** Paper trading (simulation)");
  }

  lines.push(
    "",
    "**Risk warnings:**",
    "- Market orders execute at prevailing prices and may differ from quotes.",
    "- Past performance does not guarantee future results.",
    "- Only invest what you can afford to lose.",
    "",
    "Reply with **Confirm**, **Execute**, or **Place Order** to proceed with a live order.",
  );

  return lines.join("\n");
}
