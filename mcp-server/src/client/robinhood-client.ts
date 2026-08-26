import {
  isCryptoEnabled,
  isPaperTrading,
  loadConfig,
  ROBINHOOD_API_BASE,
} from "../config.js";
import { getTokenManager } from "../auth/token-manager.js";
import { getPaperTradingStore } from "../paper-trading/store.js";
import { getRateLimiter } from "../utils/rate-limiter.js";
import { withRetry } from "../utils/retry.js";
import {
  AuthenticationError,
  InvalidSymbolError,
  MarketClosedError,
  NetworkError,
  RateLimitError,
} from "../utils/errors.js";
import type {
  AccountProfile,
  CryptoSide,
  HistoricalBar,
  HistoricalInterval,
  HistoricalSpan,
  MarketNews,
  Order,
  OrderHistory,
  Portfolio,
  Position,
  Quote,
  TradeResult,
  Watchlist,
} from "../types/index.js";

interface PaginatedResponse<T> {
  results: T[];
  next: string | null;
}

interface RobinhoodAccount {
  account_number: string;
  type: string;
  buying_power: string;
  cash: string;
  portfolio_cash: string;
  cash_available_for_withdrawal: string;
  unsettled_funds: string;
  margin_balances?: { day_trade_buying_power: string };
  created_at: string;
}

interface RobinhoodPortfolio {
  url: string;
  equity: string;
  extended_hours_equity: string;
  market_value: string;
  last_core_equity: string;
}

interface RobinhoodPosition {
  quantity: string;
  average_buy_price: string;
  instrument: string;
}

interface RobinhoodInstrument {
  symbol: string;
}

interface RobinhoodQuote {
  symbol: string;
  last_trade_price: string;
  bid_price: string;
  ask_price: string;
  previous_close: string;
  volume: string;
  updated_at: string;
}

interface RobinhoodOrder {
  id: string;
  symbol?: string;
  side: string;
  type: string;
  quantity: string;
  price: string | null;
  state: string;
  created_at: string;
  cumulative_quantity: string;
  instrument: string;
}

const INTERVAL_MAP: Record<HistoricalInterval, string> = {
  "5minute": "5minute",
  "10minute": "10minute",
  hour: "hour",
  day: "day",
  week: "week",
};

const SPAN_MAP: Record<HistoricalSpan, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
  "5year": "5year",
};

export class RobinhoodClient {
  private instrumentCache = new Map<string, string>();

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const config = loadConfig();
    const limiter = getRateLimiter(config.ROBINHOOD_RATE_LIMIT_PER_MINUTE);

    return withRetry(async () => {
      await limiter.acquire();

      let token: string;
      try {
        token = await getTokenManager().getAccessToken();
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError("Unable to authenticate with Robinhood.");
      }

      const url = path.startsWith("http") ? path : `${ROBINHOOD_API_BASE}${path}`;

      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(options.headers ?? {}),
          },
        });
      } catch (error) {
        throw new NetworkError(error);
      }

      if (response.status === 401) {
        getTokenManager().invalidate();
        throw new AuthenticationError(
          "Access token expired or invalid.",
          "Token refresh will be attempted on next request.",
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(
          retryAfter ? parseInt(retryAfter, 10) : undefined,
        );
      }

      if (!response.ok) {
        const body = await response.text();
        if (response.status === 400 && body.includes("market")) {
          throw new MarketClosedError();
        }
        throw new Error(`Robinhood API error (${response.status}): ${body.slice(0, 200)}`);
      }

      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    });
  }

  private async paginate<T>(initialPath: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | null = initialPath;

    while (next) {
      const page = await this.request<PaginatedResponse<T>>(next);
      items.push(...page.results);
      next = page.next;
    }

    return items;
  }

  async getAccountProfile(): Promise<AccountProfile> {
    if (isPaperTrading()) {
      return getPaperTradingStore().getAccountProfile();
    }

    const accounts = await this.paginate<RobinhoodAccount>("/accounts/?default_to_all_accounts=true");
    const account = accounts[0];
    if (!account) {
      throw new Error("No Robinhood account found.");
    }

    const portfolios = await this.paginate<RobinhoodPortfolio>("/portfolios/");
    const portfolio = portfolios[0];

    const buyingPower = parseFloat(account.buying_power);
    const cash = parseFloat(account.cash);
    const equity = portfolio ? parseFloat(portfolio.equity) : buyingPower;
    const marketValue = portfolio ? parseFloat(portfolio.market_value) : 0;

    return {
      accountId: account.account_number,
      accountType: account.type,
      marginStatus: account.margin_balances ? "margin" : "cash",
      buyingPower,
      cashAvailable: cash,
      portfolioValue: marketValue + cash,
      equity,
      dayTradeStatus: account.margin_balances
        ? `day_trade_bp: ${account.margin_balances.day_trade_buying_power}`
        : "cash_account",
    };
  }

  async getPortfolio(): Promise<Portfolio> {
    if (isPaperTrading()) {
      return getPaperTradingStore().getPortfolio();
    }

    const rawPositions = await this.paginate<RobinhoodPosition>(
      "/positions/?nonzero=true",
    );

    const positions: Position[] = [];

    for (const pos of rawPositions) {
      const instrument = await this.request<RobinhoodInstrument>(pos.instrument);
      const symbol = instrument.symbol;
      const quantity = parseFloat(pos.quantity);
      const averageCost = parseFloat(pos.average_buy_price);

      let currentPrice = averageCost;
      try {
        const quote = await this.getQuote(symbol);
        currentPrice = quote.currentPrice;
      } catch {
        // Use average cost if quote unavailable
      }

      const totalMarketValue = quantity * currentPrice;
      const unrealizedGainLoss = (currentPrice - averageCost) * quantity;

      positions.push({
        symbol,
        quantity,
        averageCost,
        currentPrice,
        unrealizedGainLoss,
        totalMarketValue,
        percentChange:
          averageCost > 0
            ? ((currentPrice - averageCost) / averageCost) * 100
            : 0,
      });
    }

    const totalValue = positions.reduce((s, p) => s + p.totalMarketValue, 0);
    const totalUnrealizedGainLoss = positions.reduce(
      (s, p) => s + p.unrealizedGainLoss,
      0,
    );

    return { positions, totalValue, totalUnrealizedGainLoss };
  }

  async getWatchlists(): Promise<Watchlist[]> {
    if (isPaperTrading()) {
      return getPaperTradingStore().getWatchlists();
    }

    const lists = await this.paginate<{ name: string; url: string }>(
      "/watchlists/",
    );

    const watchlists: Watchlist[] = [];

    for (const list of lists) {
      const items = await this.paginate<{ instrument: string }>(list.url);
      const symbols: string[] = [];

      for (const item of items) {
        const instrument = await this.request<RobinhoodInstrument>(
          item.instrument,
        );
        symbols.push(instrument.symbol);
      }

      watchlists.push({
        name: list.name,
        id: list.url.split("/").filter(Boolean).pop() ?? list.name,
        symbols,
      });
    }

    return watchlists;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const normalized = symbol.toUpperCase();

    if (isPaperTrading()) {
      // Simulated quote with slight random variation for paper mode
      const base = hashSymbol(normalized);
      const price = base + (Math.random() - 0.5) * base * 0.02;
      const quote: Quote = {
        symbol: normalized,
        currentPrice: round2(price),
        bid: round2(price * 0.999),
        ask: round2(price * 1.001),
        previousClose: round2(base),
        volume: Math.floor(Math.random() * 1_000_000),
        marketCap: null,
      };
      getPaperTradingStore().updateQuotePrice(normalized, quote.currentPrice);
      return quote;
    }

    const data = await this.request<RobinhoodQuote>(
      `/quotes/${normalized}/`,
    );

    if (!data?.symbol) {
      throw new InvalidSymbolError(symbol);
    }

    return {
      symbol: data.symbol,
      currentPrice: parseFloat(data.last_trade_price),
      bid: parseFloat(data.bid_price),
      ask: parseFloat(data.ask_price),
      previousClose: parseFloat(data.previous_close),
      volume: parseInt(data.volume, 10) || 0,
      marketCap: null,
    };
  }

  async getMarketNews(symbol: string): Promise<MarketNews> {
    const normalized = symbol.toUpperCase();

    if (isPaperTrading()) {
      return {
        symbol: normalized,
        articles: [
          {
            title: `Market update for ${normalized}`,
            url: `https://robinhood.com/stocks/${normalized}`,
            publishedAt: new Date().toISOString(),
            source: "Paper Trading",
            summary: "Simulated news in paper trading mode.",
          },
        ],
        sentimentSummary: "Neutral (paper trading simulation)",
      };
    }

    const instrumentId = await this.resolveInstrumentId(normalized);
    const data = await this.request<PaginatedResponse<{
      title: string;
      url: string;
      published_at: string;
      source: string;
      summary?: string;
    }>>(`/midlands/news/instrument/${instrumentId}/`);

    const articles = data.results.slice(0, 10).map((a) => ({
      title: a.title,
      url: a.url,
      publishedAt: a.published_at,
      source: a.source,
      summary: a.summary,
    }));

    return {
      symbol: normalized,
      articles,
      sentimentSummary: articles.length
        ? `${articles.length} recent articles found. Review headlines for sentiment.`
        : "No recent news found.",
    };
  }

  async getHistoricalData(
    symbol: string,
    interval: HistoricalInterval,
    span: HistoricalSpan,
  ): Promise<HistoricalBar[]> {
    const normalized = symbol.toUpperCase();
    const instrumentId = await this.resolveInstrumentId(normalized);

    if (isPaperTrading()) {
      return generatePaperHistorical(normalized, interval, span);
    }

    const data = await this.request<{ historicals: Array<{
      begins_at: string;
      open_price: string;
      high_price: string;
      low_price: string;
      close_price: string;
      volume: number;
    }> }>(
      `/marketdata/historicals/${instrumentId}/?interval=${INTERVAL_MAP[interval]}&span=${SPAN_MAP[span]}&bounds=regular`,
    );

    return (data.historicals ?? []).map((bar) => ({
      timestamp: bar.begins_at,
      open: parseFloat(bar.open_price),
      high: parseFloat(bar.high_price),
      low: parseFloat(bar.low_price),
      close: parseFloat(bar.close_price),
      volume: bar.volume,
    }));
  }

  async getOpenOrders(): Promise<Order[]> {
    if (isPaperTrading()) {
      return getPaperTradingStore().getOpenOrders();
    }

    const raw = await this.paginate<RobinhoodOrder>(
      "/orders/?state=queued,confirmed,partially_filled,unconfirmed",
    );
    return this.mapOrders(raw);
  }

  async getOrderHistory(): Promise<OrderHistory> {
    if (isPaperTrading()) {
      return getPaperTradingStore().getOrderHistory();
    }

    const all = await this.paginate<RobinhoodOrder>("/orders/");
    const mapped = await this.mapOrders(all);

    return {
      filled: mapped.filter((o) => o.status === "filled"),
      canceled: mapped.filter((o) => o.status === "canceled"),
      pending: mapped.filter((o) =>
        ["queued", "confirmed", "partially_filled", "unconfirmed"].includes(
          o.status,
        ),
      ),
    };
  }

  async cancelOrder(orderId: string): Promise<Order> {
    if (isPaperTrading()) {
      return getPaperTradingStore().cancelOrder(orderId);
    }

    await this.request(`/orders/${orderId}/cancel/`, { method: "POST" });
    const orders = await this.paginate<RobinhoodOrder>(`/orders/${orderId}/`);
    const mapped = await this.mapOrders(orders);
    return mapped[0] ?? {
      orderId,
      symbol: "unknown",
      side: "buy",
      type: "unknown",
      quantity: 0,
      price: null,
      status: "canceled",
      createdAt: new Date().toISOString(),
    };
  }

  async placeMarketBuy(
    symbol: string,
    amount: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    const quote = await this.getQuote(symbol);

    if (isPaperTrading()) {
      return getPaperTradingStore().placeMarketBuy(symbol, amount, quote, dryRun);
    }

    if (dryRun) {
      const quantity = amount / quote.currentPrice;
      return {
        orderId: "dry-run",
        symbol,
        side: "buy",
        quantity,
        estimatedCost: amount,
        status: "dry_run",
        dryRun: true,
        message: "Dry run — no order placed.",
      };
    }

    const instrumentUrl = await this.resolveInstrumentUrl(symbol);
    const accountUrl = await this.getDefaultAccountUrl();

    const body = {
      account: accountUrl,
      instrument: instrumentUrl,
      symbol: symbol.toUpperCase(),
      type: "market",
      time_in_force: "gfd",
      trigger: "immediate",
      amount: amount.toFixed(2),
      side: "buy",
    };

    const result = await this.request<RobinhoodOrder>("/orders/", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      orderId: result.id,
      symbol,
      side: "buy",
      quantity: parseFloat(result.quantity),
      estimatedCost: amount,
      status: result.state,
      dryRun: false,
      message: `Market buy order ${result.id} submitted.`,
    };
  }

  async placeMarketSell(
    symbol: string,
    quantity: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    const quote = await this.getQuote(symbol);

    if (isPaperTrading()) {
      return getPaperTradingStore().placeMarketSell(symbol, quantity, quote, dryRun);
    }

    if (dryRun) {
      return {
        orderId: "dry-run",
        symbol,
        side: "sell",
        quantity,
        estimatedCost: quantity * quote.currentPrice,
        status: "dry_run",
        dryRun: true,
        message: "Dry run — no order placed.",
      };
    }

    const instrumentUrl = await this.resolveInstrumentUrl(symbol);
    const accountUrl = await this.getDefaultAccountUrl();

    const body = {
      account: accountUrl,
      instrument: instrumentUrl,
      symbol: symbol.toUpperCase(),
      type: "market",
      time_in_force: "gfd",
      trigger: "immediate",
      quantity: quantity.toString(),
      side: "sell",
    };

    const result = await this.request<RobinhoodOrder>("/orders/", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      orderId: result.id,
      symbol,
      side: "sell",
      quantity,
      estimatedCost: quantity * quote.currentPrice,
      status: result.state,
      dryRun: false,
      message: `Market sell order ${result.id} submitted.`,
    };
  }

  async placeLimitBuy(
    symbol: string,
    quantity: number,
    limitPrice: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    return this.placeLimitOrder(symbol, "buy", quantity, limitPrice, dryRun);
  }

  async placeLimitSell(
    symbol: string,
    quantity: number,
    limitPrice: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    return this.placeLimitOrder(symbol, "sell", quantity, limitPrice, dryRun);
  }

  private async placeLimitOrder(
    symbol: string,
    side: "buy" | "sell",
    quantity: number,
    limitPrice: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    const quote = await this.getQuote(symbol);
    const cost = quantity * limitPrice;

    if (isPaperTrading()) {
      return getPaperTradingStore().placeLimitOrder(
        symbol,
        side,
        quantity,
        limitPrice,
        dryRun,
      );
    }

    if (dryRun) {
      return {
        orderId: "dry-run",
        symbol,
        side,
        quantity,
        estimatedCost: cost,
        status: "dry_run",
        dryRun: true,
        message: "Dry run — no limit order placed.",
      };
    }

    const instrumentUrl = await this.resolveInstrumentUrl(symbol);
    const accountUrl = await this.getDefaultAccountUrl();

    const body = {
      account: accountUrl,
      instrument: instrumentUrl,
      symbol: symbol.toUpperCase(),
      type: "limit",
      time_in_force: "gfd",
      trigger: "immediate",
      price: limitPrice.toFixed(2),
      quantity: quantity.toString(),
      side,
    };

    const result = await this.request<RobinhoodOrder>("/orders/", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      orderId: result.id,
      symbol,
      side,
      quantity,
      estimatedCost: cost,
      status: result.state,
      dryRun: false,
      message: `Limit ${side} order ${result.id} submitted at $${limitPrice.toFixed(2)}.`,
    };
  }

  async placeStopLoss(
    symbol: string,
    quantity: number,
    stopPrice: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    const cost = quantity * stopPrice;

    if (isPaperTrading()) {
      return getPaperTradingStore().placeStopLoss(
        symbol,
        quantity,
        stopPrice,
        dryRun,
      );
    }

    if (dryRun) {
      return {
        orderId: "dry-run",
        symbol,
        side: "sell",
        quantity,
        estimatedCost: cost,
        status: "dry_run",
        dryRun: true,
        message: "Dry run — no stop-loss placed.",
      };
    }

    const instrumentUrl = await this.resolveInstrumentUrl(symbol);
    const accountUrl = await this.getDefaultAccountUrl();

    const body = {
      account: accountUrl,
      instrument: instrumentUrl,
      symbol: symbol.toUpperCase(),
      type: "market",
      time_in_force: "gfd",
      trigger: "stop",
      stop_price: stopPrice.toFixed(2),
      quantity: quantity.toString(),
      side: "sell",
    };

    const result = await this.request<RobinhoodOrder>("/orders/", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      orderId: result.id,
      symbol,
      side: "sell",
      quantity,
      estimatedCost: cost,
      status: result.state,
      dryRun: false,
      message: `Stop-loss order ${result.id} submitted at $${stopPrice.toFixed(2)}.`,
    };
  }

  async placeCryptoOrder(
    symbol: string,
    side: CryptoSide,
    amount: number,
    dryRun: boolean,
  ): Promise<TradeResult> {
    if (!isCryptoEnabled()) {
      throw new Error(
        "Cryptocurrency trading is disabled. Set ROBINHOOD_CRYPTO_ENABLED=true.",
      );
    }

    if (isPaperTrading()) {
      const quote = await this.getQuote(symbol);
      if (side === "buy") {
        return getPaperTradingStore().placeMarketBuy(symbol, amount, quote, dryRun);
      }
      const quantity = amount / quote.currentPrice;
      return getPaperTradingStore().placeMarketSell(symbol, quantity, quote, dryRun);
    }

    if (dryRun) {
      return {
        orderId: "dry-run",
        symbol,
        side,
        quantity: amount,
        estimatedCost: amount,
        status: "dry_run",
        dryRun: true,
        message: "Dry run — no crypto order placed.",
      };
    }

    const currencyPairId = await this.resolveCryptoPairId(symbol);
    const accountUrl = await this.getDefaultAccountUrl();

    const body = {
      account_id: accountUrl.split("/").filter(Boolean).pop(),
      currency_pair_id: currencyPairId,
      type: "market",
      side,
      [side === "buy" ? "asset_quantity" : "asset_quantity"]: amount.toString(),
    };

    const result = await this.request<{ id: string; state: string }>(
      "/crypto/orders/",
      { method: "POST", body: JSON.stringify(body) },
    );

    return {
      orderId: result.id,
      symbol,
      side,
      quantity: amount,
      estimatedCost: amount,
      status: result.state,
      dryRun: false,
      message: `Crypto ${side} order ${result.id} submitted.`,
    };
  }

  private async getDefaultAccountUrl(): Promise<string> {
    const accounts = await this.paginate<{ url: string }>(
      "/accounts/?default_to_all_accounts=true",
    );
    const account = accounts[0];
    if (!account) {
      throw new Error("No Robinhood account found.");
    }
    return account.url;
  }

  private async resolveInstrumentUrl(symbol: string): Promise<string> {
    const id = await this.resolveInstrumentId(symbol);
    return `${ROBINHOOD_API_BASE}/instruments/${id}/`;
  }

  private async resolveInstrumentId(symbol: string): Promise<string> {
    const normalized = symbol.toUpperCase();
    const cached = this.instrumentCache.get(normalized);
    if (cached) return cached;

    const data = await this.request<PaginatedResponse<{ id: string }>>(
      `/instruments/?symbol=${normalized}`,
    );

    const instrument = data.results[0];
    if (!instrument) {
      throw new InvalidSymbolError(symbol);
    }

    this.instrumentCache.set(normalized, instrument.id);
    return instrument.id;
  }

  private async resolveCryptoPairId(symbol: string): Promise<string> {
    const normalized = symbol.toUpperCase();
    const data = await this.request<PaginatedResponse<{ id: string }>>(
      `/crypto/currency_pairs/?asset_currency_code=${normalized}`,
    );
    const pair = data.results[0];
    if (!pair) {
      throw new InvalidSymbolError(symbol);
    }
    return pair.id;
  }

  private async mapOrders(raw: RobinhoodOrder[]): Promise<Order[]> {
    const orders: Order[] = [];

    for (const o of raw) {
      let symbol = o.symbol ?? "unknown";
      if (!o.symbol && o.instrument) {
        try {
          const instrument = await this.request<RobinhoodInstrument>(
            o.instrument,
          );
          symbol = instrument.symbol;
        } catch {
          // keep unknown
        }
      }

      orders.push({
        orderId: o.id,
        symbol,
        side: o.side as "buy" | "sell",
        type: o.type,
        quantity: parseFloat(o.quantity),
        price: o.price ? parseFloat(o.price) : null,
        status: o.state,
        createdAt: o.created_at,
        filledQuantity: parseFloat(o.cumulative_quantity),
      });
    }

    return orders;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  return round2(50 + (Math.abs(hash) % 450));
}

function generatePaperHistorical(
  symbol: string,
  interval: HistoricalInterval,
  span: HistoricalSpan,
): HistoricalBar[] {
  const base = hashSymbol(symbol);
  const barCount = span === "day" ? 78 : span === "week" ? 35 : 30;
  const bars: HistoricalBar[] = [];
  let price = base;

  for (let i = barCount; i >= 0; i--) {
    const delta = (Math.random() - 0.48) * base * 0.01;
    price = round2(Math.max(1, price + delta));
    const open = price;
    const close = round2(price + (Math.random() - 0.5) * base * 0.005);
    bars.push({
      timestamp: new Date(Date.now() - i * intervalMs(interval)).toISOString(),
      open,
      high: round2(Math.max(open, close) * 1.002),
      low: round2(Math.min(open, close) * 0.998),
      close,
      volume: Math.floor(Math.random() * 100_000),
    });
  }

  return bars;
}

function intervalMs(interval: HistoricalInterval): number {
  switch (interval) {
    case "5minute":
      return 5 * 60_000;
    case "10minute":
      return 10 * 60_000;
    case "hour":
      return 60 * 60_000;
    case "day":
      return 24 * 60 * 60_000;
    case "week":
      return 7 * 24 * 60 * 60_000;
  }
}

let sharedClient: RobinhoodClient | null = null;

export function getRobinhoodClient(): RobinhoodClient {
  if (!sharedClient) {
    sharedClient = new RobinhoodClient();
  }
  return sharedClient;
}
