# Robinhood MCP Tools Reference

## Account Tools

### get_account_profile

Returns account ID, type, margin status, buying power, cash, portfolio value, equity, and day trade status.

### get_portfolio

Returns positions array with:

- `symbol`, `quantity`, `averageCost`, `currentPrice`
- `unrealizedGainLoss`, `totalMarketValue`, `percentChange`
- Aggregates: `totalValue`, `totalUnrealizedGainLoss`

### get_watchlists

Returns array of `{ name, id, symbols[] }`.

---

## Market Data Tools

### get_quote

**Input:** `symbol` (string)

**Returns:** `currentPrice`, `bid`, `ask`, `previousClose`, `volume`, `marketCap`

### get_market_news

**Input:** `symbol` (string)

**Returns:** `articles[]` (title, url, publishedAt, source, summary), `sentimentSummary`

### get_historical_data

**Input:**

| Parameter | Values |
|-----------|--------|
| `symbol` | Ticker string |
| `interval` | `5minute`, `10minute`, `hour`, `day`, `week` |
| `span` | `day`, `week`, `month`, `year`, `5year` |

**Returns:** `{ symbol, interval, span, bars[] }` where each bar has `timestamp`, `open`, `high`, `low`, `close`, `volume`.

---

## Order Management Tools

### get_open_orders

Returns active orders: `orderId`, `symbol`, `side`, `type`, `quantity`, `price`, `status`, `createdAt`.

### get_order_history

Returns `{ filled[], canceled[], pending[] }`.

### cancel_order

**Input:** `order_id` (string)

**Returns:** Updated order object with `status: "canceled"`.

---

## Trading Tools

All trading tools accept `dry_run` (boolean, **default: true**).

| Tool | Parameters | Notes |
|------|------------|-------|
| `place_market_buy` | `symbol`, `amount` | Dollar amount |
| `place_market_sell` | `symbol`, `quantity` | Share count |
| `place_limit_buy` | `symbol`, `quantity`, `limit_price` | |
| `place_limit_sell` | `symbol`, `quantity`, `limit_price` | |
| `place_stop_loss` | `symbol`, `quantity`, `stop_price` | Sell only |
| `place_crypto_order` | `symbol`, `side`, `amount` | Requires `ROBINHOOD_CRYPTO_ENABLED=true` |

### dry_run Response

```json
{
  "dryRun": true,
  "tradeSummary": "## Trade Summary\n...",
  "estimatedCost": 500.00
}
```

### Live Execution Response

```json
{
  "orderId": "abc123",
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 2.64,
  "estimatedCost": 500.00,
  "status": "queued",
  "dryRun": false,
  "message": "Market buy order abc123 submitted.",
  "tradeSummary": "..."
}
```

---

## Server Features

- **Hosted MCP URL:** `https://agent.robinhood.com/mcp/trading`
- **Local transport:** stdio (default) or HTTP (`--transport=http`)
- **Token refresh:** Automatic via `ROBINHOOD_REFRESH_TOKEN`
- **Rate limiting:** Configurable via `ROBINHOOD_RATE_LIMIT_PER_MINUTE` (default 60/min)
- **Retry logic:** 3 attempts with exponential backoff on transient failures
- **Audit logging:** All trade requests logged to `ROBINHOOD_AUDIT_LOG_PATH` (secrets redacted)
