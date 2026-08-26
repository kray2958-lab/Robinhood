---
name: techanalysis
description: >-
  Batch technical analysis agent. Reads ticker symbols from stocklist.xlsx, runs
  BuySkill and SellSkill for each ticker, and writes results to TechnicalSignal.xlsx.
  Use when the user asks for TechAnalysis, batch buy/sell screening, technical scan
  from Excel, or stocklist.xlsx / TechnicalSignal.xlsx workflows.
---

# TechAnalysis Agent

Batch agent that screens a list of tickers for **BUY** and **SELL** signals using [BuySkill](../buyskill/SKILL.md) and [SellSkill](../sellskill/SKILL.md).

## Input

| File | Description |
| ---- | ----------- |
| `stocklist.xlsx` | Excel file with one ticker per row |

**Ticker column** — the script detects the first matching header (case-insensitive):

- `Ticker`
- `Symbol`
- `Stock`
- `Tickers`

If none match, the **first column** is used.

## Output

| File | Description |
| ---- | ----------- |
| `TechnicalSignal.xlsx` | One row per ticker with BuySkill and SellSkill indicator values and signals |

If `TechnicalSignal.xlsx` already exists, it is copied to **`TechnicalSignal_Bak.xlsx`** before the new results are written. If `TechnicalSignal_Bak.xlsx` already exists, it is **overwritten** with the previous `TechnicalSignal.xlsx` content.

### Output columns

| Column | Description |
| ------ | ----------- |
| Ticker | Symbol analyzed |
| Date | Analysis date |
| RSI(14), RVOL, SMA50, SMA200 | Shared indicator values |
| Signal | `Buy`, `Sell`, or `None` |
| Stochastic Bullish | `TRUE` or `FALSE` |
| Golden Cross Recent | Boolean |
| RSI Oversold | Boolean |
| Buy RVOL > 2 | Boolean |
| Stochastic Bearish | `TRUE` or `FALSE` |
| Death Cross Recent | Boolean |
| RSI Overbought | Boolean |
| Sell RVOL > 2 | Boolean |

---

## Workflow

1. Ensure `stocklist.xlsx` exists in the project root (or pass `--input`).
2. Install dependencies:

```bash
pip install -r .cursor/skills/techanalysis/requirements.txt
pip install -r .cursor/skills/buyskill/requirements.txt
pip install -r .cursor/skills/sellskill/requirements.txt
```

3. Run the batch script:

```bash
python .cursor/skills/techanalysis/scripts/run_technical_buy.py
```

Optional paths:

```bash
python .cursor/skills/techanalysis/scripts/run_technical_buy.py --input stocklist.xlsx --output TechnicalSignal.xlsx
```

4. Report summary to the user:
   - Total tickers processed
   - Count of `Buy` vs `Sell` vs `None` signals
   - Path to `TechnicalSignal.xlsx`
5. Highlight any tickers with a **Buy** or **Sell** signal.

---

For TechAnalysis + DCF crosscheck, use [FundamentalAnalysis](../fundamentalanalysis/SKILL.md).

---

## BuySkill rules (per ticker)

**BUY** only when **all** conditions pass:

```text
✓ Golden Cross occurred within last 5 trading days
✓ RSI(14) < 30
✓ %K crossed above %D within last 3 trading days
✓ RVOL > 2.0
```

See [buyskill/SKILL.md](../buyskill/SKILL.md) for full indicator definitions.

## SellSkill rules (per ticker)

**SELL** only when **all** conditions pass:

```text
✓ Death Cross occurred within last 5 trading days
✓ RSI(14) > 70
✓ %K crossed below %D within last 3 trading days
✓ RVOL > 2.0
```

See [sellskill/SKILL.md](../sellskill/SKILL.md) for full indicator definitions.

---

## Error handling

| Situation | Behavior |
| --------- | -------- |
| Missing `stocklist.xlsx` | Stop and report file not found |
| Empty spreadsheet | Stop and report no rows |
| No tickers in column | Stop and report no symbols found |
| Single ticker data error | Indicators show blank, Signal is `None` |
| Other tickers | Continue processing remaining tickers |
| Existing `TechnicalSignal.xlsx` | Overwrite `TechnicalSignal_Bak.xlsx` with previous output, then write new file |

---

## Example `stocklist.xlsx`

| Ticker |
| ------ |
| AAPL   |
| MSFT   |
| NVDA   |
| TSLA   |

---

## Scheduled run (daily 9:00 AM Mountain Time)

Register a Windows scheduled task (runs even when Cursor is closed):

```powershell
powershell -ExecutionPolicy Bypass -File .cursor\skills\techanalysis\scripts\register_daily_schedule.ps1
```

This creates task **`Robinhood-TechAnalysis`**, which runs daily at **9:00 AM local computer time** (use a Mountain Time zone on Windows so it follows MST/MDT automatically).

Manual test of the scheduled command:

```powershell
powershell -ExecutionPolicy Bypass -File .cursor\skills\techanalysis\scripts\run_scheduled.ps1
```

To remove the schedule:

```powershell
Unregister-ScheduledTask -TaskName Robinhood-TechAnalysis -Confirm:$false
```

---

## Disclaimer

Technical screening only — not financial advice. Past patterns do not guarantee future results.
