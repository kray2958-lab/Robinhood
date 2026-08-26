#!/usr/bin/env python3
"""Compute DCF intrinsic value and crosscheck against current stock price."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from typing import Any

import numpy as np
import pandas as pd


def _cashflow_row(cashflow: pd.DataFrame, *labels: str) -> pd.Series | None:
    for label in labels:
        if label in cashflow.index:
            return cashflow.loc[label]
    return None


def _balance_row(balance: pd.DataFrame, *labels: str) -> float | None:
    for label in labels:
        if label in balance.index:
            value = balance.loc[label].iloc[0]
            if pd.notna(value):
                return float(value)
    return None


def fetch_current_price(ticker: str) -> tuple[float, date]:
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError(
            "yfinance is not installed. Run: pip install -r requirements.txt"
        ) from exc

    symbol = ticker.upper().strip()
    data = yf.download(
        symbol,
        period="5d",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
    )

    if data is None or data.empty or "Close" not in data.columns:
        stock = yf.Ticker(symbol)
        info = stock.info or {}
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if not price or pd.isna(price):
            raise ValueError("Unable to retrieve market data.")
        return float(price), date.today()

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    close = data["Close"].dropna()
    if close.empty:
        raise ValueError("Unable to retrieve market data.")

    return float(close.iloc[-1]), pd.to_datetime(close.index[-1]).date()


def calculate_dcf(ticker: str, current_price: float) -> dict[str, Any]:
    import yfinance as yf

    stock = yf.Ticker(ticker.upper().strip())
    cashflow = stock.cashflow
    balance = stock.balance_sheet
    info = stock.info or {}

    if cashflow is None or cashflow.empty:
        return {"dcf_available": False, "dcf_error": "Insufficient cash flow data for DCF."}

    fcf_series = _cashflow_row(cashflow, "Free Cash Flow")
    if fcf_series is None:
        operating = _cashflow_row(cashflow, "Operating Cash Flow", "Total Cash From Operating Activities")
        capex = _cashflow_row(cashflow, "Capital Expenditure")
        if operating is None or capex is None:
            return {"dcf_available": False, "dcf_error": "Insufficient cash flow data for DCF."}
        fcf_series = operating + capex

    fcf_values = [float(v) for v in fcf_series.tolist() if pd.notna(v)]
    if not fcf_values or fcf_values[0] <= 0:
        return {"dcf_available": False, "dcf_error": "Insufficient cash flow data for DCF."}

    latest_fcf = fcf_values[0]
    growth_rate = 0.03
    if len(fcf_values) >= 2 and fcf_values[-1] > 0:
        years = len(fcf_values) - 1
        cagr = (fcf_values[0] / fcf_values[-1]) ** (1 / years) - 1
        growth_rate = float(np.clip(cagr, 0.0, 0.15))

    beta = info.get("beta")
    wacc = 0.10 if beta is None or pd.isna(beta) else float(np.clip(0.04 + float(beta) * 0.06, 0.08, 0.15))
    terminal_growth = 0.025
    projection_years = 5

    discounted_fcf = 0.0
    projected_fcf = latest_fcf
    for year in range(1, projection_years + 1):
        projected_fcf *= 1 + growth_rate
        discounted_fcf += projected_fcf / (1 + wacc) ** year

    terminal_fcf = projected_fcf * (1 + terminal_growth)
    terminal_value = terminal_fcf / (wacc - terminal_growth)
    discounted_terminal = terminal_value / (1 + wacc) ** projection_years
    enterprise_value = discounted_fcf + discounted_terminal

    total_debt = _balance_row(balance, "Total Debt", "Long Term Debt") or 0.0
    cash = _balance_row(balance, "Cash And Cash Equivalents", "Cash") or 0.0
    net_debt = total_debt - cash
    equity_value = enterprise_value - net_debt

    shares = info.get("sharesOutstanding")
    if not shares or pd.isna(shares) or shares <= 0:
        return {"dcf_available": False, "dcf_error": "Insufficient share count data for DCF."}

    dcf_value = equity_value / float(shares)
    if dcf_value <= 0:
        return {"dcf_available": False, "dcf_error": "DCF produced non-positive intrinsic value."}

    price_pct_of_dcf = (current_price / dcf_value) * 100
    price_below_dcf = current_price < dcf_value

    return {
        "dcf_available": True,
        "dcf_value": round(dcf_value, 2),
        "current_price": round(current_price, 2),
        "price_pct_of_dcf": round(price_pct_of_dcf, 1),
        "price_below_dcf": price_below_dcf,
        "price_above_dcf": not price_below_dcf,
        "dcf_crosscheck": "Undervalued" if price_below_dcf else "Overvalued",
        "dcf_assumptions": {
            "wacc": round(wacc, 4),
            "fcf_growth_rate": round(growth_rate, 4),
            "terminal_growth_rate": terminal_growth,
            "projection_years": projection_years,
            "latest_fcf": round(latest_fcf, 0),
        },
    }


def analyze(ticker: str) -> dict[str, Any]:
    symbol = ticker.upper().strip()
    try:
        current_price, analysis_date = fetch_current_price(symbol)
        dcf = calculate_dcf(symbol, current_price)
    except ValueError as exc:
        return {"ticker": symbol, "error": str(exc)}
    except Exception:
        return {"ticker": symbol, "error": "Unable to retrieve market data."}

    if not dcf.get("dcf_available"):
        return {"ticker": symbol, "date": analysis_date.isoformat(), **dcf}

    return {
        "ticker": symbol,
        "date": analysis_date.isoformat(),
        **dcf,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="DCF crosscheck for a stock ticker.")
    parser.add_argument("ticker", help="Ticker symbol (e.g., AAPL)")
    args = parser.parse_args()
    result = analyze(args.ticker)
    print(json.dumps(result, indent=2))
    return 0 if "error" not in result and result.get("dcf_available", False) else 1


if __name__ == "__main__":
    sys.exit(main())
