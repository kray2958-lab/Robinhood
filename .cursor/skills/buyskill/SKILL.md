---
name: buyskill
description: >-
  Analyzes a stock ticker for a technical BUY signal using Golden Cross, RSI(14),
  Slow Stochastic crossover, and Relative Volume (RVOL). Use when the user asks
  for a BUY signal, buy analysis, technical entry check, or mentions BuySkill for
  a ticker symbol (e.g., AAPL, MSFT, NVDA, TSLA).
---

# BuySkill

Analyze historical market data and return a BUY signal only when **ALL** technical conditions are satisfied.

## Input

```text
Ticker Symbol (e.g., AAPL, MSFT, NVDA, TSLA)
```

## Workflow

1. Accept the ticker symbol from the user.
2. Install dependencies if needed:

```bash
pip install -r .cursor/skills/buyskill/requirements.txt
```

3. Run the analysis script:

```bash
python .cursor/skills/buyskill/scripts/analyze_buy_signal.py TICKER
```

4. Parse the JSON output and present results per [Output Requirements](#output-requirements).
5. If `"error"` is present in JSON, return only the error JSON — do not fabricate indicator values.

### Data source

Default: **Yahoo Finance** via `yfinance` (handled by the script).

Alternatives if yfinance fails and the user has API keys: Polygon.io, Alpha Vantage, or IEX Cloud. Fetch at least **250 hourly bars** of OHLCV (`Open`, `High`, `Low`, `Close`, `Volume`) over about **60 calendar days** (`interval=1h`) and apply the same indicator logic below.

---

## Indicator Calculations

All indicators use a **1-hour** chart (`interval=1h`) with about **60 calendar days** of history.

### 1. Golden Cross (Must Be Recent)

Calculate:

* SMA50 = 50-Day Simple Moving Average
* SMA200 = 200-Day Simple Moving Average

A valid Golden Cross occurs when:

```python
SMA50_today > SMA200_today
and
SMA50_yesterday <= SMA200_yesterday
```

The Golden Cross must have occurred within the most recent **~5 trading days** (**35 hourly bars**).

```python
golden_cross_recent = False
golden_cross_date = None

for i in range(1, 6):
    if (
        sma50.iloc[-i] > sma200.iloc[-i]
        and
        sma50.iloc[-i-1] <= sma200.iloc[-i-1]
    ):
        golden_cross_recent = True
        golden_cross_date = historical_data.index[-i]
        days_since_cross = i - 1
        break
```

**Pass:** `golden_cross_recent == True`

**Fail:** SMA50 below SMA200, cross > 5 days ago, no crossover, or insufficient data.

### 2. RSI Oversold Recovery

```python
RSI(14)
```

**Pass:** Within the last **~10 trading days** (**70 hourly bars**), RSI(14) touched **≤ 20**, then **crossed above 30** (previous ≤ 30, current > 30). Store latest RSI as `rsi_value`.

```python
rsi_oversold = False

for i in range(1, 71):
    if rsi.iloc[-i] > 30 and rsi.iloc[-i - 1] <= 30:
        before = rsi.iloc[max(0, len(rsi) - i - 70):-i]
        if (before <= 20).any():
            rsi_oversold = True
            break
```

**Fail:** No ≤20 → cross-above-30 recovery within the lookback.

### 3. Slow Stochastic Bullish Crossover

```python
%K (14,3)
%D (3-period moving average of %K)
```

**Pass:** `%K` crosses above `%D` within the last **~3 trading days** (**21 hourly bars**).

```python
stochastic_bullish = False

for i in range(1, 22):
    if (
        k.iloc[-i] > d.iloc[-i]
        and
        k.iloc[-i-1] <= d.iloc[-i-1]
    ):
        stochastic_bullish = True
        break
```

### 4. Relative Volume (RVOL)

```python
RVOL = Current Volume / Average Volume(50)
```

**Pass:** `RVOL > 2.0` — store as `rvol_value`.

---

## Buy Signal Logic

```python
buy_signal = (
    golden_cross_recent
    and rsi_oversold  # touched <=20 then crossed above 30
    and stochastic_bullish
    and rvol_value > 2.0
)
```

**BUY** only when every condition passes. Otherwise **NO BUY**.

---

## Output Requirements

Always return **both** a markdown table and structured JSON.

### Markdown table

| Ticker | Date | Golden Cross Date | Days Since Cross | RSI(14) | Stochastic Bullish | RVOL | Signal |
| ------ | ---- | ----------------- | ---------------- | ------- | ------------------ | ---- | ------ |

- `Stochastic Bullish`: `Yes` or `No`
- `Signal`: `BUY` or `NO BUY`
- Use `N/A` for Golden Cross Date / Days Since Cross when no recent cross detected

### Condition checklist

After the table, show pass/fail for each rule:

```text
✓ Golden Cross occurred within last ~5 trading days (35 hourly bars)
✓ RSI(14) touched ≤20 then crossed above 30 (last ~10 trading days / 70 hourly bars)
✓ %K crossed above %D within last ~3 trading days (21 hourly bars)
✓ RVOL > 2.0
```

Use `✗` for failed conditions. When signal is **NO BUY**, list which condition(s) failed (from `failed_conditions` in JSON).

### JSON

**BUY example:**

```json
{
  "ticker": "AAPL",
  "date": "2026-06-17",
  "golden_cross_recent": true,
  "golden_cross_date": "2026-06-13",
  "days_since_cross": 3,
  "sma50": 208.34,
  "sma200": 207.12,
  "rsi14": 27.3,
  "rsi_oversold": true,
  "stochastic_bullish": true,
  "rvol": 2.45,
  "rvol_gt_2": true,
  "buy": true
}
```

**NO BUY example:** same structure with `"buy": false` and appropriate boolean flags.

---

## Error Handling

**Data retrieval failure:**

```json
{
  "ticker": "AAPL",
  "error": "Unable to retrieve market data."
}
```

**Insufficient history (< 250 hourly bars):**

```json
{
  "ticker": "AAPL",
  "error": "Insufficient historical data to calculate indicators."
}
```

---

## Final Rule

A stock is a **BUY** only if:

```text
✓ Golden Cross occurred within last ~5 trading days (35 hourly bars)
✓ RSI(14) touched ≤20 then crossed above 30 (last ~10 trading days / 70 hourly bars)
✓ %K crossed above %D within last ~3 trading days (21 hourly bars)
✓ RVOL > 2.0
```

If any condition fails → **NO BUY** and identify the failed condition(s).

---

## Disclaimer

This skill provides technical analysis only — not financial advice. Past patterns do not guarantee future results.
