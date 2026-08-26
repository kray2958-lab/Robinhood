---
name: fundamentalanalysis
description: >-
  Runs TechAnalysis then DCF crosscheck on Buy/Sell signals from stocklist.xlsx.
  Writes TechnicalSignal.xlsx and DCFAnalysis.xlsx. Use when the user asks for
  FundamentalAnalysis, technical plus DCF pipeline, or DCFAnalysis.xlsx workflows.
---

# FundamentalAnalysis

Runs [TechAnalysis](../techanalysis/SKILL.md), then [DCF crosscheck](../dcf-crosscheck/SKILL.md) on every **Buy** or **Sell** signal.

## Workflow

1. Ensure `stocklist.xlsx` exists in the project root.
2. Install dependencies:

```bash
pip install -r .cursor/skills/fundamentalanalysis/requirements.txt
pip install -r .cursor/skills/techanalysis/requirements.txt
pip install -r .cursor/skills/buyskill/requirements.txt
pip install -r .cursor/skills/sellskill/requirements.txt
pip install -r .cursor/skills/dcf-crosscheck/requirements.txt
```

3. Run from the project root:

```bash
python .cursor/skills/fundamentalanalysis/scripts/run_techanalysis_with_dcf.py
```

Use existing `TechnicalSignal.xlsx` without re-running TechAnalysis:

```bash
python .cursor/skills/fundamentalanalysis/scripts/run_techanalysis_with_dcf.py --skip-techanalysis
```

## Output

| File | Description |
| ---- | ----------- |
| `TechnicalSignal.xlsx` | Full technical scan (all tickers) |
| `DCFAnalysis.xlsx` | DCF results for Buy/Sell signals only |

Backups: `TechnicalSignal_Bak.xlsx`, `DCFAnalysis_Bak.xlsx`

### DCFAnalysis columns

| Column | Description |
| ------ | ----------- |
| Ticker | Symbol |
| Signal | `Buy` or `Sell` |
| Date | DCF analysis date |
| DCF Value | Intrinsic value per share |
| Current Price | Latest market price |
| Average Analyst Price | Mean analyst price target (Yahoo Finance) |
| Average Analyst Recommendation | Consensus rating (e.g. `2.0 - Buy`) |
| Price % of DCF | Price as % of DCF |
| DCF Crosscheck | `Undervalued` or `Overvalued` |
| Price Below DCF | Boolean |
| Price Above DCF | Boolean |
| DCF Error | Error when DCF unavailable |

---

## Disclaimer

Technical and valuation screening only — not financial advice.
