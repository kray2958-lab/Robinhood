---
name: robinhood-trading-assistant
description: >-
  Connects to the Robinhood MCP server to retrieve account data, portfolio
  positions, market quotes, and execute trades with mandatory user confirmation.
  Use when the user asks about Robinhood accounts, buying power, portfolio,
  positions, stock prices, open orders, or wants to buy/sell stocks, ETFs, or
  crypto through Robinhood.
---

# Robinhood Trading Assistant

Secure MCP client workflow for Robinhood account queries and trade execution.

## Prerequisites

1. Robinhood MCP server configured at `https://agent.robinhood.com/mcp/trading` (see [README.md](../../README.md))
2. MCP server added in Cursor (see [mcp-config.example.json](../../mcp-config.example.json))
3. Environment variables set (never log or display secrets):

| Variable | Purpose |
|----------|---------|
| `ROBINHOOD_CLIENT_ID` | OAuth client ID |
| `ROBINHOOD_CLIENT_SECRET` | OAuth client secret (optional) |
| `ROBINHOOD_ACCESS_TOKEN` | Current access token |
| `ROBINHOOD_REFRESH_TOKEN` | Token for automatic refresh |
| `ROBINHOOD_MCP_SERVER_URL` | Robinhood MCP endpoint (`https://agent.robinhood.com/mcp/trading`) |
| `ROBINHOOD_PAPER_TRADING` | `true` for simulation mode |

## MCP Tools Reference

Read [reference.md](reference.md) for full tool schemas and response fields.

## Safety Rules (Mandatory)

**Never execute trades automatically.** Follow this workflow for every trade request:

### Read-Only Queries (no confirmation needed)

Use these tools directly:

- `get_account_profile` — buying power, cash, equity, day trade status
- `get_portfolio` — positions with P&L
- `get_watchlists` — watchlists and symbols
- `get_quote` — current price, bid/ask, volume
- `get_market_news` — news and sentiment
- `get_historical_data` — OHLCV bars
- `get_open_orders` / `get_order_history` — order status

### Trade Requests (confirmation required)

1. **Validate** the request (symbol, amount/quantity, buying power, position size).
2. **Call the trade tool with `dry_run: true`** (this is the default).
3. **Display the trade summary** returned by the tool:

```markdown
## Trade Summary

| Field | Value |
|-------|-------|
| Symbol | AAPL |
| Side | BUY |
| Order Type | Market Buy |
| Amount | $500.00 |
| Current Price | $189.50 |
| Estimated Cost | $500.00 |

**Risk warnings:**
- Market orders execute at prevailing prices and may differ from quotes.
- Past performance does not guarantee future results.
- Only invest what you can afford to lose.

Reply with **Confirm**, **Execute**, or **Place Order** to proceed.
```

4. **Wait for explicit confirmation** — only these responses authorize execution:
   - "Confirm"
   - "Execute"
   - "Place Order"

5. **Re-call the same trade tool with `dry_run: false`** only after confirmation.

6. **Report the result** including order ID and status.

### Never Do

- Call trade tools with `dry_run: false` without user confirmation
- Batch multiple live trades without confirming each one
- Expose tokens, secrets, or credentials in responses or logs
- Skip buying power or position size validation

## Response Formats

### Account Queries

```markdown
## Account Overview

| Metric | Value |
|--------|-------|
| Portfolio Value | $XX,XXX.XX |
| Buying Power | $X,XXX.XX |
| Cash Balance | $X,XXX.XX |
| Today's Gain/Loss | $XXX.XX |

### Positions
| Symbol | Qty | Avg Cost | Price | P&L |
|--------|-----|----------|-------|-----|
| AAPL | 10 | $150.00 | $189.50 | +$395.00 |
```

### Trade Requests

Always show trade summary first, then ask for confirmation. Never skip the summary.

## Error Handling

When MCP tools return errors, translate to actionable messages:

| Error Code | User Message |
|------------|--------------|
| `AUTHENTICATION_FAILED` | Credentials expired — refresh tokens in environment variables |
| `INSUFFICIENT_FUNDS` | Not enough buying power — show available vs required |
| `INSUFFICIENT_SHARES` | Not enough shares to sell — show position size |
| `INVALID_SYMBOL` | Ticker not found — ask user to verify symbol |
| `MARKET_CLOSED` | Market closed — suggest limit order or wait |
| `RATE_LIMITED` | Too many requests — wait and retry |
| `NETWORK_ERROR` | Connection failed — check network and server status |

## Paper Trading Mode

When `ROBINHOOD_PAPER_TRADING=true`:

- All trades are simulated with $100,000 starting cash
- Still require confirmation workflow (good practice)
- Clearly label all responses as **Paper Trading**

## Example Workflows

See [examples.md](examples.md) for complete interaction examples.

## Quick Tool Mapping

| User Request | MCP Tool |
|--------------|----------|
| "Show my portfolio" | `get_portfolio` + `get_account_profile` |
| "Buying power?" | `get_account_profile` |
| "Price of NVDA?" | `get_quote` |
| "Buy $500 of AAPL" | `place_market_buy` (dry_run first) |
| "Sell 10 TSLA" | `place_market_sell` (dry_run first) |
| "Open orders" | `get_open_orders` |
| "Cancel order 12345" | `cancel_order` |
| "News on MSFT" | `get_market_news` |
