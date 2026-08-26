---
name: sellskill
description: >-
  Analyzes a stock ticker for a technical SELL signal using Death Cross, RSI(14),
  Slow Stochastic bearish crossover, and Relative Volume (RVOL). Use when the user
  asks for a SELL signal, sell analysis, technical exit check, or mentions SellSkill
  for a ticker symbol (e.g., AAPL, MSFT, NVDA, TSLA).
---

# SellSkill

Analyze historical market data and return a SELL signal only when **ALL** technical conditions are satisfied.

## Input

```text
Ticker Symbol (e.g., AAPL, MSFT, NVDA, TSLA)
```

## Workflow

1. Accept the ticker symbol from the user.
2. Install dependencies if needed:

```bash
pip install -r .cursor/skills/sellskill/requirements.txt
```

3. Run the analysis script:

```bash
python .cursor/skills/sellskill/scripts/analyze_sell_signal.py TICKER
```

4. Parse the JSON output and present results per [Response Format](#response-format).
5. If `"error"` is present in JSON, return only the error JSON — do not fabricate indicator values.

### Data source

Default: **Yahoo Finance** via `yfinance` (handled by the script).

Alternatives if yfinance fails and the user has API keys: Polygon.io, Alpha Vantage, or IEX Cloud. Fetch at least **250 trading days** of daily OHLCV (`Open`, `High`, `Low`, `Close`, `Volume`) and apply the same indicator logic below.

---

## Indicator Calculations

### 1. Death Cross (Must Be Recent)

Calculate:

* SMA50 = 50-Day Simple Moving Average
* SMA200 = 200-Day Simple Moving Average

A valid Death Cross occurs when:

```python
SMA50_today < SMA200_today
and
SMA50_yesterday >= SMA200_yesterday
```

The Death Cross must have occurred within the most recent **5 trading days**.

```python
death_cross_recent = False
death_cross_date = None

for i in range(1, 6):
    if (
        sma50.iloc[-i] < sma200.iloc[-i]
        and
        sma50.iloc[-i-1] >= sma200.iloc[-i-1]
    ):
        death_cross_recent = True
        death_cross_date = historical_data.index[-i]
        days_since_cross = i - 1
        break
```

**Pass:** `death_cross_recent == True`

**Fail:** SMA50 above SMA200, cross > 5 days ago, no crossover, or insufficient data.

### 2. RSI Overbought

```python
RSI(14)
```

**Pass:** `RSI(14) > 70` — store as `rsi_value`.

### 3. Slow Stochastic Bearish Crossover

```python
%K (14,3)
%D (3-period moving average of %K)
```

**Pass:** `%K` crosses below `%D` today or within the last **3** trading sessions.

```python
stochastic_bearish = False

for i in range(1, 4):
    if (
        k.iloc[-i] < d.iloc[-i]
        and
        k.iloc[-i-1] >= d.iloc[-i-1]
    ):
        stochastic_bearish = True
        break
```

### 4. Relative Volume (RVOL)

```python
RVOL = Current Volume / Average Volume(50)
```

**Pass:** `RVOL > 2.0` — store as `rvol_value`.

---

## Sell Signal Logic

```python
sell_signal = (
    death_cross_recent
    and rsi_value > 70
    and stochastic_bearish
    and rvol_value > 2.0
)
```

**SELL** only when every condition passes. Otherwise **NO SELL**.

---

## Response Format

Always provide:

1. Summary Table
2. Indicator Values
3. Pass/Fail Status for Each Rule
4. JSON Output
5. Final Recommendation (SELL or NO SELL)

The final recommendation must only be **SELL** when all four conditions pass.

### Summary table

| Ticker | Date | Death Cross Date | Days Since Cross | RSI(14) | Stochastic Bearish | RVOL | Signal |
| ------ | ---- | ---------------- | ---------------- | ------- | ------------------ | ---- | ------ |

- `Stochastic Bearish`: `Yes` or `No`
- `Signal`: `SELL` or `NO SELL`
- Use `N/A` for Death Cross Date / Days Since Cross when no recent cross detected

### Indicator values

After the table, list current values:

- SMA50, SMA200
- RSI(14)
- RVOL

### Pass/fail checklist

```text
✓ Death Cross occurred within last 5 trading days
✓ RSI(14) > 70
✓ %K crossed below %D within last 3 trading days
✓ RVOL > 2.0
```

Use `✗` for failed conditions. When signal is **NO SELL**, list which condition(s) failed (from `failed_conditions` in JSON).

### JSON

**SELL example:**

```json
{
  "ticker": "AAPL",
  "date": "2026-06-17",
  "death_cross_recent": true,
  "death_cross_date": "2026-06-15",
  "days_since_cross": 2,
  "sma50": 206.11,
  "sma200": 207.42,
  "rsi14": 74.6,
  "rsi_overbought": true,
  "stochastic_bearish": true,
  "rvol": 2.83,
  "rvol_gt_2": true,
  "sell": true
}
```

**NO SELL example:** same structure with `"sell": false` and appropriate boolean flags.

---

## Error Handling

**Data retrieval failure:**

```json
{
  "ticker": "AAPL",
  "error": "Unable to retrieve market data."
}
```

**Insufficient history (< 250 trading days):**

```json
{
  "ticker": "AAPL",
  "error": "Insufficient historical data to calculate indicators."
}
```

---

## Final Rule

A stock is a **SELL** only if:

```text
✓ Death Cross occurred within last 5 trading days
✓ RSI(14) > 70
✓ %K crossed below %D within last 3 trading days
✓ RVOL > 2.0
```

If any condition fails → **NO SELL** and identify the failed condition(s).

---

## Disclaimer

This skill provides technical analysis only — not financial advice. Past patterns do not guarantee future results.
