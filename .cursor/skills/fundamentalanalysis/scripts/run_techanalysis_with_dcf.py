#!/usr/bin/env python3
"""Run TechAnalysis, then DCF crosscheck for Buy/Sell signals."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path
from typing import Any, Callable

import pandas as pd

SKILLS_DIR = Path(__file__).resolve().parents[2]
TECHANALYSIS_SCRIPT = SKILLS_DIR / "techanalysis/scripts/run_technical_buy.py"
DCF_SCRIPT = SKILLS_DIR / "dcf-crosscheck/scripts/dcf_crosscheck.py"
SIGNAL_VALUES = {"buy", "sell"}


def load_module(script_path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_analyze(script_path: Path, module_name: str) -> Callable[[str], dict[str, Any]]:
    return load_module(script_path, module_name).analyze


def fetch_analyst_data(ticker: str) -> dict[str, Any]:
    try:
        import yfinance as yf
    except ImportError:
        return {"avg_analyst_price": None, "avg_analyst_recommendation": None}

    symbol = ticker.upper().strip()
    try:
        info = yf.Ticker(symbol).info or {}
        price = info.get("targetMeanPrice")
        avg_price = round(float(price), 2) if price is not None and not pd.isna(price) else None

        recommendation = info.get("averageAnalystRating")
        if recommendation is not None and not pd.isna(recommendation):
            avg_recommendation = str(recommendation).strip()
        else:
            key = info.get("recommendationKey")
            avg_recommendation = str(key).replace("_", " ").title() if key else None

        return {
            "avg_analyst_price": avg_price,
            "avg_analyst_recommendation": avg_recommendation,
        }
    except Exception:
        return {"avg_analyst_price": None, "avg_analyst_recommendation": None}


def analyst_columns(analyst: dict[str, Any]) -> dict[str, Any]:
    return {
        "Average Analyst Price": analyst.get("avg_analyst_price"),
        "Average Analyst Recommendation": analyst.get("avg_analyst_recommendation"),
    }


def read_actionable_signals(signal_path: Path) -> pd.DataFrame:
    if not signal_path.exists():
        raise FileNotFoundError(f"Signal file not found: {signal_path}")

    frame = pd.read_excel(signal_path)
    if frame.empty or "Ticker" not in frame.columns or "Signal" not in frame.columns:
        raise ValueError("TechnicalSignal.xlsx must include Ticker and Signal columns.")

    signals = frame["Signal"].astype(str).str.strip().str.lower()
    actionable = frame.loc[signals.isin(SIGNAL_VALUES)].copy()
    actionable["Signal"] = actionable["Signal"].astype(str).str.strip()
    return actionable


def dcf_result_to_row(
    signal: str, ticker: str, result: dict[str, Any], analyst: dict[str, Any]
) -> dict[str, Any]:
    analyst_fields = analyst_columns(analyst)
    if "error" in result:
        return {
            "Ticker": ticker,
            "Signal": signal,
            "Date": result.get("date"),
            "DCF Value": None,
            "Current Price": None,
            **analyst_fields,
            "Price % of DCF": None,
            "DCF Crosscheck": None,
            "Price Below DCF": None,
            "Price Above DCF": None,
            "DCF Error": result["error"],
        }

    if not result.get("dcf_available"):
        return {
            "Ticker": ticker,
            "Signal": signal,
            "Date": result.get("date"),
            "DCF Value": None,
            "Current Price": None,
            **analyst_fields,
            "Price % of DCF": None,
            "DCF Crosscheck": None,
            "Price Below DCF": None,
            "Price Above DCF": None,
            "DCF Error": result.get("dcf_error", "DCF unavailable."),
        }

    return {
        "Ticker": ticker,
        "Signal": signal,
        "Date": result.get("date"),
        "DCF Value": result.get("dcf_value"),
        "Current Price": result.get("current_price"),
        **analyst_fields,
        "Price % of DCF": result.get("price_pct_of_dcf"),
        "DCF Crosscheck": result.get("dcf_crosscheck"),
        "Price Below DCF": result.get("price_below_dcf"),
        "Price Above DCF": result.get("price_above_dcf"),
        "DCF Error": None,
    }


def run_dcf_analysis(
    signals: pd.DataFrame, analyze_dcf: Callable[[str], dict[str, Any]]
) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for _, row in signals.iterrows():
        ticker = str(row["Ticker"]).strip().upper()
        signal = str(row["Signal"]).strip()
        analyst = fetch_analyst_data(ticker)
        rows.append(dcf_result_to_row(signal, ticker, analyze_dcf(ticker), analyst))
    return pd.DataFrame(rows)


def run_pipeline(
    stocklist_path: Path,
    signal_path: Path,
    dcf_output_path: Path,
    skip_techanalysis: bool = False,
) -> tuple[pd.DataFrame, pd.DataFrame, Path | None, Path | None]:
    techanalysis_mod = load_module(TECHANALYSIS_SCRIPT, "run_technical_buy")
    signal_backup: Path | None = None

    if skip_techanalysis:
        if not signal_path.exists():
            raise FileNotFoundError(
                f"Signal file not found: {signal_path}. Run TechAnalysis first or omit --skip-techanalysis."
            )
        technical = pd.read_excel(signal_path)
    else:
        technical, signal_backup = techanalysis_mod.run_batch(stocklist_path, signal_path)

    actionable = read_actionable_signals(signal_path)
    analyze_dcf = load_analyze(DCF_SCRIPT, "dcf_crosscheck")

    if actionable.empty:
        dcf_output = pd.DataFrame(
            columns=[
                "Ticker",
                "Signal",
                "Date",
                "DCF Value",
                "Current Price",
                "Average Analyst Price",
                "Average Analyst Recommendation",
                "Price % of DCF",
                "DCF Crosscheck",
                "Price Below DCF",
                "Price Above DCF",
                "DCF Error",
            ]
        )
    else:
        dcf_output = run_dcf_analysis(actionable, analyze_dcf)

    dcf_output_path.parent.mkdir(parents=True, exist_ok=True)
    dcf_backup = techanalysis_mod.backup_output_if_exists(dcf_output_path)
    dcf_output.to_excel(dcf_output_path, index=False)

    return technical, dcf_output, signal_backup, dcf_backup


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run TechAnalysis and DCF crosscheck for Buy/Sell signals."
    )
    parser.add_argument(
        "--input",
        default="stocklist.xlsx",
        help="Input Excel file with ticker symbols (default: stocklist.xlsx)",
    )
    parser.add_argument(
        "--signal-output",
        default="TechnicalSignal.xlsx",
        help="Technical analysis output file (default: TechnicalSignal.xlsx)",
    )
    parser.add_argument(
        "--dcf-output",
        default="DCFAnalysis.xlsx",
        help="DCF analysis output file (default: DCFAnalysis.xlsx)",
    )
    parser.add_argument(
        "--skip-techanalysis",
        action="store_true",
        help="Skip TechAnalysis and use existing TechnicalSignal.xlsx",
    )
    args = parser.parse_args()

    try:
        technical, dcf_output, signal_backup, dcf_backup = run_pipeline(
            Path(args.input),
            Path(args.signal_output),
            Path(args.dcf_output),
            skip_techanalysis=args.skip_techanalysis,
        )
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if signal_backup:
        print(f"Backed up existing file to {signal_backup}.")
    if dcf_backup:
        print(f"Backed up existing file to {dcf_backup}.")

    buy_count = int((technical["Signal"] == "Buy").sum()) if "Signal" in technical.columns else 0
    sell_count = int((technical["Signal"] == "Sell").sum()) if "Signal" in technical.columns else 0
    print(
        f"TechAnalysis: {len(technical)} ticker(s). "
        f"Buy: {buy_count}, Sell: {sell_count}, None: {len(technical) - buy_count - sell_count}. "
        f"Wrote {args.signal_output}."
    )
    print(
        f"DCF crosscheck: {len(dcf_output)} actionable signal(s). Wrote {args.dcf_output}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
