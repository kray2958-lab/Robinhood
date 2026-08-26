# Robinhood Trading Assistant — Examples

## Example 1: Portfolio Overview

**User:** Show my portfolio.

**Agent actions:**
1. Call `get_account_profile`
2. Call `get_portfolio`

**Response:**

```markdown
## Account Overview

| Metric | Value |
|--------|-------|
| Portfolio Value | $52,340.00 |
| Buying Power | $3,210.50 |
| Cash Balance | $1,500.00 |
| Equity | $52,340.00 |

## Positions

| Symbol | Qty | Avg Cost | Price | Market Value | P&L |
|--------|-----|----------|-------|--------------|-----|
| AAPL | 25 | $150.00 | $189.50 | $4,737.50 | +$987.50 |
| MSFT | 15 | $320.00 | $415.00 | $6,225.00 | +$1,425.00 |
| NVDA | 10 | $450.00 | $875.00 | $8,750.00 | +$4,250.00 |

**Total unrealized P&L:** +$6,662.50
```

---

## Example 2: Market Buy with Confirmation

**User:** Buy $500 of AAPL.

**Agent actions:**
1. Call `place_market_buy` with `{ symbol: "AAPL", amount: 500, dry_run: true }`
2. Display trade summary from response
3. Wait for confirmation

**Response (step 2):**

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
| Estimated Fees | $0.00 |

**Risk warnings:**
- Market orders execute at prevailing prices and may differ from quotes.
- Past performance does not guarantee future results.
- Only invest what you can afford to lose.

Reply with **Confirm**, **Execute**, or **Place Order** to proceed with a live order.
```

**User:** Confirm

**Agent actions:**
4. Call `place_market_buy` with `{ symbol: "AAPL", amount: 500, dry_run: false }`

**Response:**

```markdown
Order submitted successfully.

| Field | Value |
|-------|-------|
| Order ID | a1b2c3d4 |
| Symbol | AAPL |
| Side | BUY |
| Estimated Shares | ~2.64 |
| Estimated Cost | $500.00 |
| Status | queued |
```

---

## Example 3: Sell with Validation Error

**User:** Sell 100 shares of TSLA.

**Agent actions:**
1. Call `get_portfolio` to check position
2. If user holds only 10 shares, report error before calling trade tool

**Response:**

```markdown
Unable to place sell order.

You hold **10 shares** of TSLA but requested to sell **100 shares**.

Would you like to sell your full position (10 shares) instead?
```

---

## Example 4: Quote Lookup

**User:** What's the current price of NVDA?

**Agent actions:**
1. Call `get_quote` with `{ symbol: "NVDA" }`

**Response:**

```markdown
## NVDA Quote

| Field | Value |
|-------|-------|
| Current Price | $875.20 |
| Bid | $875.10 |
| Ask | $875.30 |
| Previous Close | $868.50 |
| Volume | 42,150,000 |
| Change | +$6.70 (+0.77%) |
```

---

## Example 5: Cancel Order

**User:** Cancel order abc12345.

**Agent actions:**
1. Call `get_open_orders` to verify order exists
2. Call `cancel_order` with `{ order_id: "abc12345" }`

**Response:**

```markdown
Order **abc12345** (AAPL limit buy, 5 shares @ $185.00) has been canceled.
```

---

## Example 6: Paper Trading

**User:** Buy $200 of MSFT (paper trading mode).

**Agent actions:**
1. Call `place_market_buy` with dry_run first
2. After confirmation, execute with dry_run false
3. Label response as paper trading

**Response:**

```markdown
**Paper Trading** — simulated order filled.

| Field | Value |
|-------|-------|
| Order ID | paper-7f3a |
| Symbol | MSFT |
| Side | BUY |
| Amount | $200.00 |
| Status | filled |

Remaining paper cash: $99,800.00
```
