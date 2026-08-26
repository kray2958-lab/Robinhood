#!/usr/bin/env python3
"""Run BuySkill and SellSkill analysis for each ticker in stocklist.xlsx."""

from __future__ import annotations

import argparse
import importlib.util
import shutil
import sys
from pathlib import Path
from typing import Any, Callable

import pandas as pd

TICKER_COLUMNS = ("ticker", "symbol", "stock", "tickers")
SKILLS_DIR = Path(__file__).resolve().parents[2]
BUYSKILL_SCRIPT = SKILLS_DIR / "buyskill" / "scripts" / "analyze_buy_signal.py"
SELLSKILL_SCRIPT = SKILLS_DIR / "sellskill" / "scripts" / "analyze_sell_signal.py"


def load_analyze(script_path: Path, module_name: str) -> Callable[[str], dict[str, Any]]:
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module from {script_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.analyze


def find_ticker_column(frame: pd.DataFrame) -> str:
    normalized = {col: str(col).strip().lower() for col in frame.columns}
    for candidate in TICKER_COLUMNS:
        for col, name in normalized.items():
            if name == candidate:
                return col
    return frame.columns[0]


def read_tickers(input_path: Path) -> list[str]:
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    frame = pd.read_excel(input_path)
    if frame.empty:
        raise ValueError("Input spreadsheet contains no rows.")

    column = find_ticker_column(frame)
    tickers: list[str] = []
    seen: set[str] = set()
    for value in frame[column].dropna():
        ticker = str(value).strip().upper()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        tickers.append(ticker)

    if not tickers:
        raise ValueError(f"No ticker symbols found in column '{column}'.")

    return tickers


def buy_columns(result: dict[str, Any]) -> dict[str, Any]:
    if "error" in result:
        return {
            "Stochastic Bullish": None,
            "Golden Cross Recent": None,
            "RSI Oversold": None,
            "Buy RVOL > 2": None,
        }

    return {
        "Stochastic Bullish": "TRUE" if result.get("stochastic_bullish") else "FALSE",
        "Golden Cross Recent": result.get("golden_cross_recent"),
        "RSI Oversold": result.get("rsi_oversold"),
        "Buy RVOL > 2": result.get("rvol_gt_2"),
    }


def sell_columns(result: dict[str, Any]) -> dict[str, Any]:
    if "error" in result:
        return {
            "Stochastic Bearish": None,
            "Death Cross Recent": None,
            "RSI Overbought": None,
            "Sell RVOL > 2": None,
        }

    return {
        "Stochastic Bearish": "TRUE" if result.get("stochastic_bearish") else "FALSE",
        "Death Cross Recent": result.get("death_cross_recent"),
        "RSI Overbought": result.get("rsi_overbought"),
        "Sell RVOL > 2": result.get("rvol_gt_2"),
    }


def combined_signal(buy_result: dict[str, Any], sell_result: dict[str, Any]) -> str:
    if "error" not in buy_result and buy_result.get("buy"):
        return "Buy"
    if "error" not in sell_result and sell_result.get("sell"):
        return "Sell"
    return "None"


def shared_columns(buy_result: dict[str, Any], sell_result: dict[str, Any]) -> dict[str, Any]:
    ticker = buy_result.get("ticker") or sell_result.get("ticker") or ""
    source = buy_result if "error" not in buy_result else sell_result
    if "error" in source:
        return {
            "Ticker": ticker,
            "Date": None,
            "RSI(14)": None,
            "RVOL": None,
            "SMA50": None,
            "SMA200": None,
        }
    return {
        "Ticker": source["ticker"],
        "Date": source["date"],
        "RSI(14)": source.get("rsi14"),
        "RVOL": source.get("rvol"),
        "SMA50": source.get("sma50"),
        "SMA200": source.get("sma200"),
    }


def result_to_row(buy_result: dict[str, Any], sell_result: dict[str, Any]) -> dict[str, Any]:
    row = shared_columns(buy_result, sell_result)
    row["Signal"] = combined_signal(buy_result, sell_result)
    row.update(buy_columns(buy_result))
    row.update(sell_columns(sell_result))
    return row


def backup_output_if_exists(output_path: Path) -> Path | None:
    if not output_path.exists():
        return None
    backup_path = output_path.with_name(f"{output_path.stem}_Bak{output_path.suffix}")
    if backup_path.exists():
        backup_path.unlink()
    shutil.copy2(output_path, backup_path)
    return backup_path


def run_batch(input_path: Path, output_path: Path) -> tuple[pd.DataFrame, Path | None]:
    analyze_buy = load_analyze(BUYSKILL_SCRIPT, "analyze_buy_signal")
    analyze_sell = load_analyze(SELLSKILL_SCRIPT, "analyze_sell_signal")
    tickers = read_tickers(input_path)
    rows = [
        result_to_row(analyze_buy(ticker), analyze_sell(ticker))
        for ticker in tickers
    ]
    output = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path = backup_output_if_exists(output_path)
    output.to_excel(output_path, index=False)
    return output, backup_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run BuySkill and SellSkill for each ticker in stocklist.xlsx."
    )
    parser.add_argument(
        "--input",
        default="stocklist.xlsx",
        help="Input Excel file with ticker symbols (default: stocklist.xlsx)",
    )
    parser.add_argument(
        "--output",
        default="TechnicalSignal.xlsx",
        help="Output Excel file for results (default: TechnicalSignal.xlsx)",
    )
    args = parser.parse_args()

    try:
        output, backup_path = run_batch(Path(args.input), Path(args.output))
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    buy_count = int((output["Signal"] == "Buy").sum())
    sell_count = int((output["Signal"] == "Sell").sum())
    if backup_path:
        print(f"Backed up existing file to {backup_path}.")
    print(
        f"Processed {len(output)} ticker(s). "
        f"Buy: {buy_count}, Sell: {sell_count}, None: {len(output) - buy_count - sell_count}. "
        f"Wrote {args.output}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
