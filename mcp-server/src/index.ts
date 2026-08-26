#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { getRobinhoodClient } from "./client/robinhood-client.js";
import { isPaperTrading, loadConfig } from "./config.js";
import { logTradeRequest } from "./safety/audit-log.js";
import {
  buildTradeSummary,
  validateBuyingPower,
  validatePositiveAmount,
  validatePositiveQuantity,
  validatePositionSize,
  validateTickerSymbol,
} from "./safety/validation.js";
import { formatErrorForMcp } from "./utils/errors.js";

const client = getRobinhoodClient();

const server = new McpServer({
  name: "robinhood-trading",
  version: "1.0.0",
});

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function safeCall<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return jsonResult(result);
  } catch (error) {
    return formatErrorForMcp(error);
  }
}

// ── Account Tools ──────────────────────────────────────────────────────────

server.tool(
  "get_account_profile",
  "Returns Robinhood account profile including buying power, cash, equity, and day trade status.",
  {},
  async () =>
    safeCall(async () => {
      const profile = await client.getAccountProfile();
      return {
        accountId: profile.accountId,
        accountType: profile.accountType,
        marginStatus: profile.marginStatus,
        buyingPower: profile.buyingPower,
        cashAvailable: profile.cashAvailable,
        portfolioValue: profile.portfolioValue,
        equity: profile.equity,
        dayTradeStatus: profile.dayTradeStatus,
        todaysGainLoss: profile.todaysGainLoss,
        paperTrading: isPaperTrading(),
      };
    }),
);

server.tool(
  "get_portfolio",
  "Returns current portfolio positions with quantity, average cost, current price, and unrealized gain/loss.",
  {},
  async () => safeCall(() => client.getPortfolio()),
);

server.tool(
  "get_watchlists",
  "Returns user watchlists and symbols in each watchlist.",
  {},
  async () => safeCall(() => client.getWatchlists()),
);

// ── Market Data Tools ──────────────────────────────────────────────────────

server.tool(
  "get_quote",
  "Returns current market quote for a symbol including price, bid, ask, volume, and previous close.",
  { symbol: z.string().describe("Stock or ETF ticker symbol (e.g. AAPL)") },
  async ({ symbol }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      return client.getQuote(validated);
    }),
);

server.tool(
  "get_market_news",
  "Returns recent news articles and sentiment summary for a symbol.",
  { symbol: z.string().describe("Stock or ETF ticker symbol") },
  async ({ symbol }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      return client.getMarketNews(validated);
    }),
);

const intervalSchema = z.enum(["5minute", "10minute", "hour", "day", "week"]);
const spanSchema = z.enum(["day", "week", "month", "year", "5year"]);

server.tool(
  "get_historical_data",
  "Returns historical OHLCV price data for a symbol.",
  {
    symbol: z.string().describe("Ticker symbol"),
    interval: intervalSchema.describe("Bar interval"),
    span: spanSchema.describe("Time span"),
  },
  async ({ symbol, interval, span }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const bars = await client.getHistoricalData(validated, interval, span);
      return { symbol: validated, interval, span, bars };
    }),
);

// ── Order Management Tools ─────────────────────────────────────────────────

server.tool(
  "get_open_orders",
  "Returns all active/open orders.",
  {},
  async () => safeCall(() => client.getOpenOrders()),
);

server.tool(
  "get_order_history",
  "Returns filled, canceled, and pending order history.",
  {},
  async () => safeCall(() => client.getOrderHistory()),
);

server.tool(
  "cancel_order",
  "Cancels a pending order by order ID.",
  { order_id: z.string().describe("Order ID to cancel") },
  async ({ order_id }) =>
    safeCall(async () => {
      const order = await client.cancelOrder(order_id);
      logTradeRequest("cancel_order", { order_id }, false, isPaperTrading());
      return order;
    }),
);

// ── Trading Tools ──────────────────────────────────────────────────────────

const dryRunSchema = z
  .boolean()
  .default(true)
  .describe(
    "When true (default), validates and returns trade summary without executing. Set false only after user confirmation.",
  );

async function prepareTradeSummary(params: {
  symbol: string;
  side: "buy" | "sell";
  quantity?: number;
  amount?: number;
  limitPrice?: number;
  stopPrice?: number;
  orderType: string;
}) {
  const quote = await client.getQuote(params.symbol);
  const account = await client.getAccountProfile();
  const portfolio = await client.getPortfolio();

  const estimatedCost =
    params.amount ??
    (params.quantity ?? 0) *
      (params.limitPrice ?? params.stopPrice ?? quote.currentPrice);

  if (params.side === "buy") {
    validateBuyingPower(estimatedCost, account);
  } else if (params.quantity !== undefined) {
    validatePositionSize(params.symbol, params.quantity, portfolio.positions);
  }

  const summary = buildTradeSummary({
    ...params,
    currentPrice: quote.currentPrice,
    estimatedCost,
    fees: 0,
    paperTrading: isPaperTrading(),
  });

  return { summary, quote, estimatedCost };
}

server.tool(
  "place_market_buy",
  "Place a market buy order for a dollar amount. Defaults to dry_run=true. Requires user confirmation before setting dry_run=false.",
  {
    symbol: z.string().describe("Ticker symbol"),
    amount: z.number().positive().describe("Dollar amount to invest"),
    dry_run: dryRunSchema,
  },
  async ({ symbol, amount, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const validAmount = validatePositiveAmount(amount, "Amount");

      logTradeRequest(
        "place_market_buy",
        { symbol: validated, amount: validAmount },
        dry_run,
        isPaperTrading(),
      );

      const { summary, estimatedCost } = await prepareTradeSummary({
        symbol: validated,
        side: "buy",
        amount: validAmount,
        orderType: "Market Buy",
      });

      if (dry_run) {
        return { dryRun: true, tradeSummary: summary, estimatedCost };
      }

      const result = await client.placeMarketBuy(validated, validAmount, false);
      return { ...result, tradeSummary: summary };
    }),
);

server.tool(
  "place_market_sell",
  "Place a market sell order for a share quantity. Defaults to dry_run=true.",
  {
    symbol: z.string().describe("Ticker symbol"),
    quantity: z.number().positive().describe("Number of shares to sell"),
    dry_run: dryRunSchema,
  },
  async ({ symbol, quantity, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const validQty = validatePositiveQuantity(quantity);

      logTradeRequest(
        "place_market_sell",
        { symbol: validated, quantity: validQty },
        dry_run,
        isPaperTrading(),
      );

      const { summary, estimatedCost } = await prepareTradeSummary({
        symbol: validated,
        side: "sell",
        quantity: validQty,
        orderType: "Market Sell",
      });

      if (dry_run) {
        return { dryRun: true, tradeSummary: summary, estimatedCost };
      }

      const result = await client.placeMarketSell(validated, validQty, false);
      return { ...result, tradeSummary: summary };
    }),
);

server.tool(
  "place_limit_buy",
  "Place a limit buy order. Defaults to dry_run=true.",
  {
    symbol: z.string(),
    quantity: z.number().positive(),
    limit_price: z.number().positive(),
    dry_run: dryRunSchema,
  },
  async ({ symbol, quantity, limit_price, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const validQty = validatePositiveQuantity(quantity);
      const validPrice = validatePositiveAmount(limit_price, "Limit price");

      logTradeRequest(
        "place_limit_buy",
        { symbol: validated, quantity: validQty, limit_price: validPrice },
        dry_run,
        isPaperTrading(),
      );

      const { summary } = await prepareTradeSummary({
        symbol: validated,
        side: "buy",
        quantity: validQty,
        limitPrice: validPrice,
        orderType: "Limit Buy",
      });

      if (dry_run) {
        return {
          dryRun: true,
          tradeSummary: summary,
          estimatedCost: validQty * validPrice,
        };
      }

      const result = await client.placeLimitBuy(
        validated,
        validQty,
        validPrice,
        false,
      );
      return { ...result, tradeSummary: summary };
    }),
);

server.tool(
  "place_limit_sell",
  "Place a limit sell order. Defaults to dry_run=true.",
  {
    symbol: z.string(),
    quantity: z.number().positive(),
    limit_price: z.number().positive(),
    dry_run: dryRunSchema,
  },
  async ({ symbol, quantity, limit_price, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const validQty = validatePositiveQuantity(quantity);
      const validPrice = validatePositiveAmount(limit_price, "Limit price");

      logTradeRequest(
        "place_limit_sell",
        { symbol: validated, quantity: validQty, limit_price: validPrice },
        dry_run,
        isPaperTrading(),
      );

      const { summary } = await prepareTradeSummary({
        symbol: validated,
        side: "sell",
        quantity: validQty,
        limitPrice: validPrice,
        orderType: "Limit Sell",
      });

      if (dry_run) {
        return {
          dryRun: true,
          tradeSummary: summary,
          estimatedCost: validQty * validPrice,
        };
      }

      const result = await client.placeLimitSell(
        validated,
        validQty,
        validPrice,
        false,
      );
      return { ...result, tradeSummary: summary };
    }),
);

server.tool(
  "place_stop_loss",
  "Place a stop-loss sell order. Defaults to dry_run=true.",
  {
    symbol: z.string(),
    quantity: z.number().positive(),
    stop_price: z.number().positive(),
    dry_run: dryRunSchema,
  },
  async ({ symbol, quantity, stop_price, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol);
      const validQty = validatePositiveQuantity(quantity);
      const validStop = validatePositiveAmount(stop_price, "Stop price");

      logTradeRequest(
        "place_stop_loss",
        { symbol: validated, quantity: validQty, stop_price: validStop },
        dry_run,
        isPaperTrading(),
      );

      const { summary } = await prepareTradeSummary({
        symbol: validated,
        side: "sell",
        quantity: validQty,
        stopPrice: validStop,
        orderType: "Stop Loss",
      });

      if (dry_run) {
        return {
          dryRun: true,
          tradeSummary: summary,
          estimatedCost: validQty * validStop,
        };
      }

      const result = await client.placeStopLoss(
        validated,
        validQty,
        validStop,
        false,
      );
      return { ...result, tradeSummary: summary };
    }),
);

server.tool(
  "place_crypto_order",
  "Place a cryptocurrency market order. Requires ROBINHOOD_CRYPTO_ENABLED=true. Defaults to dry_run=true.",
  {
    symbol: z.string().describe("Crypto symbol (e.g. BTC)"),
    side: z.enum(["buy", "sell"]),
    amount: z.number().positive().describe("Dollar amount"),
    dry_run: dryRunSchema,
  },
  async ({ symbol, side, amount, dry_run }) =>
    safeCall(async () => {
      const validated = validateTickerSymbol(symbol, true);
      const validAmount = validatePositiveAmount(amount, "Amount");

      logTradeRequest(
        "place_crypto_order",
        { symbol: validated, side, amount: validAmount },
        dry_run,
        isPaperTrading(),
      );

      const quote = await client.getQuote(validated);
      const summary = buildTradeSummary({
        symbol: validated,
        side,
        amount: validAmount,
        orderType: `Crypto Market ${side}`,
        currentPrice: quote.currentPrice,
        estimatedCost: validAmount,
        paperTrading: isPaperTrading(),
      });

      if (dry_run) {
        return { dryRun: true, tradeSummary: summary, estimatedCost: validAmount };
      }

      const result = await client.placeCryptoOrder(
        validated,
        side,
        validAmount,
        false,
      );
      return { ...result, tradeSummary: summary };
    }),
);

// ── Server Transport ─────────────────────────────────────────────────────────

async function startStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[robinhood-mcp] Running on stdio transport");
}

async function startHttp(): Promise<void> {
  const config = loadConfig();
  const port = config.ROBINHOOD_MCP_HTTP_PORT;
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", paperTrading: isPaperTrading() });
  });

  app.listen(port, () => {
    console.error(`[robinhood-mcp] HTTP transport listening on port ${port}`);
  });
}

const transportArg = process.argv.find((a) => a.startsWith("--transport="));
const transport = transportArg?.split("=")[1] ?? "stdio";

if (transport === "http") {
  await startHttp();
} else {
  await startStdio();
}
