# Robinhood MCP Trading Assistant

Production-quality MCP server and Cursor skill for secure Robinhood account access and trade execution.

## Features

- **Account tools:** profile, portfolio, watchlists
- **Market data:** quotes, news, historical OHLCV
- **Order management:** open orders, history, cancel
- **Trading:** market/limit/stop-loss orders, crypto (optional)
- **Safety:** dry-run by default, validation, audit logging, confirmation workflow via skill
- **Paper trading:** simulated mode with $100K starting balance
- **Reliability:** automatic token refresh, retry logic, rate limiting

## Quick Start

### 1. Install dependencies

```bash
cd mcp-server
npm install
npm run build
```

### 2. Configure credentials

Copy the example env file and fill in your tokens:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `ROBINHOOD_CLIENT_ID` | OAuth client ID |
| `ROBINHOOD_CLIENT_SECRET` | OAuth client secret (optional) |
| `ROBINHOOD_ACCESS_TOKEN` | Bearer access token |
| `ROBINHOOD_REFRESH_TOKEN` | Refresh token for auto-renewal |
| `ROBINHOOD_MCP_SERVER_URL` | Robinhood hosted MCP URL (`https://agent.robinhood.com/mcp/trading`) |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `ROBINHOOD_PAPER_TRADING` | `false` | Enable simulation mode |
| `ROBINHOOD_CRYPTO_ENABLED` | `false` | Enable crypto trading tools |
| `ROBINHOOD_MCP_HTTP_PORT` | `3100` | HTTP transport port |
| `ROBINHOOD_RATE_LIMIT_PER_MINUTE` | `60` | API rate limit |
| `ROBINHOOD_AUDIT_LOG_PATH` | `./logs/audit.log` | Trade audit log path |

### 3. Connect to the MCP server

**Hosted (recommended):** Robinhood provides a remote MCP server at:

```
https://agent.robinhood.com/mcp/trading
```

Configure this URL in Cursor MCP settings (see step 4).

**Local (optional):** Run the included MCP server for development or paper trading:

```bash
npm start          # stdio transport
npm run dev:http   # HTTP transport on localhost:3100
```

Health check (local only): `GET http://localhost:3100/health`

### 4. Configure Cursor MCP

Copy `mcp-config.example.json` into your Cursor MCP settings (`.cursor/mcp.json` or global `~/.cursor/mcp.json`).

The default config connects to Robinhood's hosted MCP server:

```json
{
  "mcpServers": {
    "robinhood": {
      "url": "https://agent.robinhood.com/mcp/trading",
      "headers": {
        "Authorization": "Bearer ${env:ROBINHOOD_ACCESS_TOKEN}"
      }
    }
  }
}
```

For local development, use the `robinhood-local` entry in the example config instead. Start with `ROBINHOOD_PAPER_TRADING=true` for safe testing.

### 5. Use the skill

The **Robinhood Trading Assistant** skill at `.cursor/skills/robinhood-trading-assistant/` guides the agent through safe trading workflows with mandatory confirmation.

## MCP Tools

| Category | Tools |
|----------|-------|
| Account | `get_account_profile`, `get_portfolio`, `get_watchlists` |
| Market | `get_quote`, `get_market_news`, `get_historical_data` |
| Orders | `get_open_orders`, `get_order_history`, `cancel_order` |
| Trading | `place_market_buy`, `place_market_sell`, `place_limit_buy`, `place_limit_sell`, `place_stop_loss`, `place_crypto_order` |

All trading tools default to `dry_run: true`. The skill enforces user confirmation before live execution.

## Safety

- Trades never execute without explicit user confirmation ("Confirm", "Execute", or "Place Order")
- Ticker symbols, buying power, and position sizes are validated before orders
- All trade requests are audit-logged with secrets redacted
- Paper trading mode available for risk-free testing

## Project Structure

```
Robinhood/
├── .cursor/skills/robinhood-trading-assistant/   # Cursor agent skill
│   ├── SKILL.md
│   ├── reference.md
│   └── examples.md
├── mcp-server/                                    # MCP server implementation
│   ├── src/
│   │   ├── index.ts          # MCP tool definitions
│   │   ├── config.ts         # Environment configuration
│   │   ├── auth/             # OAuth token management
│   │   ├── client/           # Robinhood API client
│   │   ├── safety/           # Validation & audit logging
│   │   ├── paper-trading/    # Simulation store
│   │   └── utils/            # Retry, rate limiting, errors
│   └── package.json
├── mcp-config.example.json
└── README.md
```

## Disclaimer

Robinhood does not provide an official public trading API. This project uses documented unofficial endpoints and OAuth flows. Use at your own risk. Always test with paper trading before live orders. This is not financial advice.
