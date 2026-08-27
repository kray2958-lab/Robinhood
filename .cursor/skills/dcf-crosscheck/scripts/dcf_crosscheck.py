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


def _positive_number(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def resolve_share_count(info: dict[str, Any], balance: pd.DataFrame | None) -> float | None:
    """Resolve shares from Yahoo info and/or balance sheet fields.

    Preference order:
    1. info.sharesOutstanding
    2. info.impliedSharesOutstanding
    3. balance sheet Ordinary Shares Number
    4. info.floatShares
    5. balance sheet Share Issued
    """
    for key in ("sharesOutstanding", "impliedSharesOutstanding"):
        shares = _positive_number(info.get(key))
        if shares is not None:
            return shares

    if balance is not None and not balance.empty:
        shares = _balance_row(balance, "Ordinary Shares Number")
        shares = _positive_number(shares)
        if shares is not None:
            return shares

    shares = _positive_number(info.get("floatShares"))
    if shares is not None:
        return shares

    if balance is not None and not balance.empty:
        shares = _balance_row(balance, "Share Issued")
        return _positive_number(shares)

    return None


def resolve_cash(balance: pd.DataFrame | None, info: dict[str, Any]) -> float:
    """Liquid assets for net-debt: prefer cash + short-term investments."""
    if balance is not None and not balance.empty:
        cash = _balance_row(
            balance,
            "Cash Cash Equivalents And Short Term Investments",
            "Cash And Cash Equivalents",
            "Cash",
        )
        if cash is not None:
            return max(cash, 0.0)

    for key in ("totalCash", "cash"):
        cash = _positive_number(info.get(key))
        if cash is not None:
            return cash
    return 0.0


def resolve_total_debt(balance: pd.DataFrame | None, info: dict[str, Any]) -> float:
    if balance is not None and not balance.empty:
        debt = _balance_row(balance, "Total Debt", "Long Term Debt")
        if debt is not None:
            return max(debt, 0.0)

    debt = _positive_number(info.get("totalDebt"))
    return debt if debt is not None else 0.0


def normalize_fcf(fcf_series: pd.Series) -> tuple[float, float, list[float]] | None:
    """Build a normalized FCF base and growth rate from annual cash-flow history.

    Uses the mean of up to the 3 most recent *positive* annual FCF figures so a
    single negative/capex-spike year does not drag the base (or block the model).
    Growth is CAGR across that positive window when 2+ points exist; if the newest
    raw year is a sharp dip vs the normalized base, keep a modest 3% default.
    """
    raw = [float(v) for v in fcf_series.tolist() if pd.notna(v)]
    if not raw:
        return None

    positive_window = [v for v in raw if v > 0][:3]
    if not positive_window:
        return None

    normalized = float(np.mean(positive_window))
    growth_rate = 0.03
    if len(positive_window) >= 2:
        years = len(positive_window) - 1
        cagr = (positive_window[0] / positive_window[-1]) ** (1 / years) - 1
        growth_rate = float(np.clip(cagr, 0.0, 0.15))

    # Newest reported year (may be negative or depressed) vs normalized base.
    if raw[0] < normalized * 0.5 and growth_rate == 0.0:
        growth_rate = 0.03

    return normalized, growth_rate, positive_window


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

    normalized = normalize_fcf(fcf_series)
    if normalized is None:
        return {"dcf_available": False, "dcf_error": "Insufficient cash flow data for DCF."}

    latest_fcf, growth_rate, fcf_window = normalized

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

    total_debt = resolve_total_debt(balance, info)
    cash = resolve_cash(balance, info)
    net_debt = total_debt - cash
    equity_value = enterprise_value - net_debt

    shares = resolve_share_count(info, balance)
    if shares is None:
        return {"dcf_available": False, "dcf_error": "Insufficient share count data for DCF."}

    dcf_value = equity_value / shares
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
            "normalized_fcf": round(latest_fcf, 0),
            "fcf_window": [round(v, 0) for v in fcf_window],
            "total_debt": round(total_debt, 0),
            "cash": round(cash, 0),
            "shares": round(shares, 0),
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
