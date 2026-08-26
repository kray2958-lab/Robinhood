export interface AccountProfile {
  accountId: string;
  accountType: string;
  marginStatus: string;
  buyingPower: number;
  cashAvailable: number;
  portfolioValue: number;
  equity: number;
  dayTradeStatus: string;
  todaysGainLoss?: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  unrealizedGainLoss: number;
  totalMarketValue: number;
  percentChange?: number;
}

export interface Portfolio {
  positions: Position[];
  totalValue: number;
  totalUnrealizedGainLoss: number;
}

export interface Watchlist {
  name: string;
  id: string;
  symbols: string[];
}

export interface Quote {
  symbol: string;
  currentPrice: number;
  bid: number;
  ask: number;
  previousClose: number;
  volume: number;
  marketCap: number | null;
}

export interface NewsArticle {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  summary?: string;
}

export interface MarketNews {
  symbol: string;
  articles: NewsArticle[];
  sentimentSummary: string;
}

export interface HistoricalBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Order {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  price: number | null;
  status: string;
  createdAt: string;
  filledQuantity?: number;
}

export interface OrderHistory {
  filled: Order[];
  canceled: Order[];
  pending: Order[];
}

export interface TradeResult {
  orderId: string;
  symbol: string;
  side: string;
  quantity: number;
  estimatedCost: number;
  status: string;
  dryRun: boolean;
  message: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type HistoricalInterval =
  | "5minute"
  | "10minute"
  | "hour"
  | "day"
  | "week";

export type HistoricalSpan =
  | "day"
  | "week"
  | "month"
  | "year"
  | "5year";

export type CryptoSide = "buy" | "sell";
