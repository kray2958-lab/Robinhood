---
name: dcf-crosscheck
description: >-
  Computes Discounted Cash Flow (DCF) intrinsic value per share and crosschecks it
  against the current stock price. Returns dcf_value, current_price, price_pct_of_dcf,
  and dcf_crosscheck (Undervalued/Overvalued). Use when the user asks for DCF analysis,
  intrinsic value, fair value, valuation crosscheck, or mentions DCF_crosscheck for a
  ticker symbol (e.g., AAPL, MSFT, NVDA, TSLA).
---

# DCF Crosscheck

Compute intrinsic value per share using Discounted Cash Flow and crosscheck against the current market price.

## Input

```text
Ticker Symbol (e.g., AAPL, MSFT, NVDA, TSLA)
```

## Workflow

1. Accept the ticker symbol from the user.
2. Install dependencies if needed:

```bash
pip install -r .cursor/skills/dcf-crosscheck/requirements.txt
```

3. Run the analysis script:

```bash
python .cursor/skills/dcf-crosscheck/scripts/dcf_crosscheck.py TICKER
```

4. Parse the JSON output and present results per [Output Requirements](#output-requirements).
5. If `"error"` is present in JSON, return only the error JSON — do not fabricate values.

### Data source

Default: **Yahoo Finance** via `yfinance` (cash flow statement, balance sheet, share count, and current price).

---

## DCF Calculation

1. **FCF history** — use `Free Cash Flow`, or `Operating Cash Flow + Capital Expenditure`.
2. **Normalized FCF** — mean of up to the 3 most recent *positive* annual FCF figures (skips negative/capex-spike years).
3. **FCF growth rate** — CAGR across that positive window (capped 0%–15%; default 3% if unavailable or if the newest year is a sharp dip).
4. **Project FCF** — 5 years forward from normalized FCF at the growth rate.
5. **Discount** — WACC default 10%, or `4% + beta × 6%` (clamped 8%–15%).
6. **Terminal value** — Gordon Growth Model with 2.5% perpetual growth.
7. **Equity value** — Enterprise Value − Net Debt, where cash prefers cash + short-term investments.
8. **DCF per share** — Equity Value ÷ Shares Outstanding (fallback: implied shares, balance-sheet ordinary shares, float shares, or shares issued).

## Crosscheck Logic

```python
price_pct_of_dcf = (current_price / dcf_value) * 100
price_below_dcf = current_price < dcf_value
dcf_crosscheck = "Undervalued" if price_below_dcf else "Overvalued"
```

| Field | Meaning |
| ----- | ------- |
| `dcf_value` | Intrinsic value per share |
| `current_price` | Latest market price |
| `price_pct_of_dcf` | Current price as % of DCF (e.g., 85.0 = 85% of intrinsic value) |
| `dcf_crosscheck` | `Undervalued` (price < DCF) or `Overvalued` (price ≥ DCF) |

---

## Output Requirements

Always return **both** a markdown table and structured JSON.

### Summary table

| Ticker | Date | Current Price | DCF Value | Price % of DCF | DCF Crosscheck |
| ------ | ---- | ------------- | --------- | -------------- | -------------- |

- `Price % of DCF`: `(current_price / dcf_value) × 100`
- `DCF Crosscheck`: `Undervalued` or `Overvalued`

### Interpretation

After the table, state:

- **Undervalued** — price trades below DCF intrinsic value (`price_pct_of_dcf < 100`)
- **Overvalued** — price trades at or above DCF intrinsic value (`price_pct_of_dcf ≥ 100`)

### JSON

```json
{
  "ticker": "AAPL",
  "date": "2026-06-17",
  "dcf_available": true,
  "dcf_value": 245.80,
  "current_price": 208.34,
  "price_pct_of_dcf": 84.8,
  "price_below_dcf": true,
  "price_above_dcf": false,
  "dcf_crosscheck": "Undervalued",
  "dcf_assumptions": {
    "wacc": 0.10,
    "fcf_growth_rate": 0.08,
    "terminal_growth_rate": 0.025,
    "projection_years": 5,
    "normalized_fcf": 99500000000,
    "fcf_window": [110000000000, 99500000000, 90000000000],
    "total_debt": 100000000000,
    "cash": 50000000000,
    "shares": 15000000000
  }
}
```

---

## Error Handling

**Data retrieval failure:**

```json
{
  "ticker": "AAPL",
  "error": "Unable to retrieve market data."
}
```

**Insufficient cash flow data:**

```json
{
  "ticker": "AAPL",
  "date": "2026-06-17",
  "dcf_available": false,
  "dcf_error": "Insufficient cash flow data for DCF."
}
```

---

## Disclaimer

This skill provides valuation analysis only — not financial advice. DCF models rely on assumptions that may not reflect future performance.
