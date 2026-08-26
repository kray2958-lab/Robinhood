import { randomUUID } from "node:crypto";
import type {
  AccountProfile,
  Order,
  OrderHistory,
  Portfolio,
  Position,
  Quote,
  TradeResult,
  Watchlist,
} from "../types/index.js";

interface PaperState {
  cash: number;
  positions: Map<string, Position>;
  orders: Order[];
}

const INITIAL_CASH = 100_000;

class PaperTradingStore {
  private state: PaperState = {
    cash: INITIAL_CASH,
    positions: new Map(),
    orders: [],
  };

  getAccountProfile(): AccountProfile {
    const portfolio = this.getPortfolio();
    return {
      accountId: "paper-account",
      accountType: "cash",
      marginStatus: "none",
      buyingPower: this.state.cash,
      cashAvailable: this.state.cash,
      portfolioValue: portfolio.totalValue + this.state.cash,
      equity: portfolio.totalValue + this.state.cash,
      dayTradeStatus: "not_applicable",
      todaysGainLoss: portfolio.totalUnrealizedGainLoss,
    };
  }

  getPortfolio(): Portfolio {
    const positions = Array.from(this.state.positions.values());
    const totalValue = positions.reduce((sum, p) => sum + p.totalMarketValue, 0);
    const totalUnrealizedGainLoss = positions.reduce(
      (sum, p) => sum + p.unrealizedGainLoss,
      0,
    );
    return { positions, totalValue, totalUnrealizedGainLoss };
  }

  getWatchlists(): Watchlist[] {
    return [
      {
        id: "paper-default",
        name: "Paper Watchlist",
        symbols: Array.from(this.state.positions.keys()),
      },
    ];
  }

  updateQuotePrice(symbol: string, price: number): void {
    const position = this.state.positions.get(symbol);
    if (position) {
      position.currentPrice = price;
      position.totalMarketValue = position.quantity * price;
      position.unrealizedGainLoss =
        (price - position.averageCost) * position.quantity;
    }
  }

  placeMarketBuy(
    symbol: string,
    amount: number,
    quote: Quote,
    dryRun: boolean,
  ): TradeResult {
    const quantity = amount / quote.currentPrice;
    const cost = amount;

    if (dryRun) {
      return this.buildResult(symbol, "buy", quantity, cost, true, "Dry run — no order placed.");
    }

    if (cost > this.state.cash) {
      throw new Error(`Insufficient paper cash. Need $${cost}, have $${this.state.cash}`);
    }

    this.state.cash -= cost;
    this.addPosition(symbol, quantity, quote.currentPrice);

    const order = this.recordOrder(symbol, "buy", "market", quantity, quote.currentPrice);
    return this.buildResult(symbol, "buy", quantity, cost, false, `Paper order ${order.orderId} filled.`);
  }

  placeMarketSell(
    symbol: string,
    quantity: number,
    quote: Quote,
    dryRun: boolean,
  ): TradeResult {
    const proceeds = quantity * quote.currentPrice;

    if (dryRun) {
      return this.buildResult(symbol, "sell", quantity, proceeds, true, "Dry run — no order placed.");
    }

    const position = this.state.positions.get(symbol);
    if (!position || position.quantity < quantity) {
      throw new Error(`Insufficient paper shares of ${symbol}`);
    }

    position.quantity -= quantity;
    if (position.quantity <= 0) {
      this.state.positions.delete(symbol);
    } else {
      position.totalMarketValue = position.quantity * quote.currentPrice;
    }

    this.state.cash += proceeds;
    const order = this.recordOrder(symbol, "sell", "market", quantity, quote.currentPrice);
    return this.buildResult(symbol, "sell", quantity, proceeds, false, `Paper order ${order.orderId} filled.`);
  }

  placeLimitOrder(
    symbol: string,
    side: "buy" | "sell",
    quantity: number,
    limitPrice: number,
    dryRun: boolean,
  ): TradeResult {
    const cost = quantity * limitPrice;

    if (dryRun) {
      return this.buildResult(symbol, side, quantity, cost, true, "Dry run — no limit order placed.");
    }

    const order = this.recordOrder(symbol, side, "limit", quantity, limitPrice, "pending");
    return this.buildResult(
      symbol,
      side,
      quantity,
      cost,
      false,
      `Paper limit order ${order.orderId} submitted at $${limitPrice.toFixed(2)}.`,
    );
  }

  placeStopLoss(
    symbol: string,
    quantity: number,
    stopPrice: number,
    dryRun: boolean,
  ): TradeResult {
    const cost = quantity * stopPrice;

    if (dryRun) {
      return this.buildResult(symbol, "sell", quantity, cost, true, "Dry run — no stop-loss placed.");
    }

    const order = this.recordOrder(symbol, "sell", "stop_loss", quantity, stopPrice, "pending");
    return this.buildResult(
      symbol,
      "sell",
      quantity,
      cost,
      false,
      `Paper stop-loss ${order.orderId} submitted at $${stopPrice.toFixed(2)}.`,
    );
  }

  getOpenOrders(): Order[] {
    return this.state.orders.filter(
      (o) => o.status === "pending" || o.status === "queued",
    );
  }

  getOrderHistory(): OrderHistory {
    const filled = this.state.orders.filter((o) => o.status === "filled");
    const canceled = this.state.orders.filter((o) => o.status === "canceled");
    const pending = this.getOpenOrders();
    return { filled, canceled, pending };
  }

  cancelOrder(orderId: string): Order {
    const order = this.state.orders.find((o) => o.orderId === orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    if (order.status !== "pending" && order.status !== "queued") {
      throw new Error(`Order ${orderId} cannot be canceled (status: ${order.status})`);
    }
    order.status = "canceled";
    return order;
  }

  private addPosition(symbol: string, quantity: number, price: number): void {
    const existing = this.state.positions.get(symbol);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      existing.averageCost =
        (existing.averageCost * existing.quantity + price * quantity) / totalQty;
      existing.quantity = totalQty;
      existing.currentPrice = price;
      existing.totalMarketValue = totalQty * price;
      existing.unrealizedGainLoss =
        (price - existing.averageCost) * totalQty;
    } else {
      this.state.positions.set(symbol, {
        symbol,
        quantity,
        averageCost: price,
        currentPrice: price,
        unrealizedGainLoss: 0,
        totalMarketValue: quantity * price,
      });
    }
  }

  private recordOrder(
    symbol: string,
    side: "buy" | "sell",
    type: string,
    quantity: number,
    price: number,
    status = "filled",
  ): Order {
    const order: Order = {
      orderId: randomUUID().slice(0, 8),
      symbol,
      side,
      type,
      quantity,
      price,
      status,
      createdAt: new Date().toISOString(),
      filledQuantity: status === "filled" ? quantity : 0,
    };
    this.state.orders.unshift(order);
    return order;
  }

  private buildResult(
    symbol: string,
    side: string,
    quantity: number,
    estimatedCost: number,
    dryRun: boolean,
    message: string,
  ): TradeResult {
    return {
      orderId: dryRun ? "dry-run" : randomUUID().slice(0, 8),
      symbol,
      side,
      quantity,
      estimatedCost,
      status: dryRun ? "dry_run" : "submitted",
      dryRun,
      message,
    };
  }
}

let paperStore: PaperTradingStore | null = null;

export function getPaperTradingStore(): PaperTradingStore {
  if (!paperStore) {
    paperStore = new PaperTradingStore();
  }
  return paperStore;
}

export function resetPaperTradingStore(): void {
  paperStore = null;
}
