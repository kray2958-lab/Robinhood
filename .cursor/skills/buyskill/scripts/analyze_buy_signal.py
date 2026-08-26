#!/usr/bin/env python3
"""Evaluate BUY signal from trend, momentum, and volume indicators."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

MIN_TRADING_DAYS = 250
LOOKBACK_CALENDAR_DAYS = 400


def fetch_ohlcv(ticker: str) -> pd.DataFrame:
    try:
        import yfinance as yf
    except ImportError as exc:
        raise RuntimeError(
            "yfinance is not installed. Run: pip install -r requirements.txt"
        ) from exc

    symbol = ticker.upper().strip()
    data = yf.download(
        symbol,
        period=f"{LOOKBACK_CALENDAR_DAYS}d",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
    )

    if data is None or data.empty:
        raise ValueError("Unable to retrieve market data.")

    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)

    required = ["Open", "High", "Low", "Close", "Volume"]
    missing = [col for col in required if col not in data.columns]
    if missing:
        raise ValueError("Unable to retrieve market data.")

    frame = data[required].copy()
    frame = frame.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    frame.index = pd.to_datetime(frame.index).tz_localize(None)
    frame = frame.sort_index()

    if len(frame) < MIN_TRADING_DAYS:
        raise ValueError("Insufficient historical data to calculate indicators.")

    return frame


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=window).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def slow_stochastic(
    high: pd.Series, low: pd.Series, close: pd.Series, k_period: int = 14, k_smooth: int = 3
) -> tuple[pd.Series, pd.Series]:
    lowest_low = low.rolling(window=k_period, min_periods=k_period).min()
    highest_high = high.rolling(window=k_period, min_periods=k_period).max()
    raw_k = 100 * (close - lowest_low) / (highest_high - lowest_low).replace(0, np.nan)
    percent_k = raw_k.rolling(window=k_smooth, min_periods=k_smooth).mean()
    percent_d = percent_k.rolling(window=k_smooth, min_periods=k_smooth).mean()
    return percent_k, percent_d


def detect_crossover(
    fast: pd.Series, slow: pd.Series, lookback_days: int
) -> tuple[bool, date | None, int | None]:
    for i in range(1, lookback_days + 1):
        if len(fast) <= i or len(slow) <= i:
            break
        fast_today = fast.iloc[-i]
        slow_today = slow.iloc[-i]
        fast_prev = fast.iloc[-i - 1]
        slow_prev = slow.iloc[-i - 1]
        if pd.isna(fast_today) or pd.isna(slow_today) or pd.isna(fast_prev) or pd.isna(slow_prev):
            continue
        if fast_today > slow_today and fast_prev <= slow_prev:
            cross_date = fast.index[-i].date()
            days_since = i - 1
            return True, cross_date, days_since
    return False, None, None


def analyze(ticker: str) -> dict[str, Any]:
    try:
        history = fetch_ohlcv(ticker)
    except ValueError as exc:
        return {"ticker": ticker.upper().strip(), "error": str(exc)}
    except Exception:
        return {"ticker": ticker.upper().strip(), "error": "Unable to retrieve market data."}

    close = history["Close"]
    high = history["High"]
    low = history["Low"]
    volume = history["Volume"]

    sma50 = sma(close, 50)
    sma200 = sma(close, 200)
    rsi14 = rsi(close, 14)
    percent_k, percent_d = slow_stochastic(high, low, close, 14, 3)
    avg_volume_50 = volume.rolling(window=50, min_periods=50).mean()

    analysis_date = close.index[-1].date()
    rsi_value = float(rsi14.iloc[-1])
    rvol_value = float(volume.iloc[-1] / avg_volume_50.iloc[-1])
    sma50_value = float(sma50.iloc[-1])
    sma200_value = float(sma200.iloc[-1])

    golden_cross_recent, golden_cross_date, days_since_cross = detect_crossover(sma50, sma200, 5)
    stochastic_bullish, _, _ = detect_crossover(percent_k, percent_d, 3)

    rsi_oversold = rsi_value < 30
    rvol_gt_2 = rvol_value > 2.0
    buy_signal = golden_cross_recent and rsi_oversold and stochastic_bullish and rvol_gt_2

    failed_conditions: list[str] = []
    if not golden_cross_recent:
        failed_conditions.append("Golden Cross did not occur within last 5 trading days")
    if not rsi_oversold:
        failed_conditions.append(f"RSI(14) not oversold ({rsi_value:.1f} >= 30)")
    if not stochastic_bullish:
        failed_conditions.append("%K did not cross above %D within last 3 trading days")
    if not rvol_gt_2:
        failed_conditions.append(f"RVOL not above 2.0 ({rvol_value:.2f})")

    return {
        "ticker": ticker.upper().strip(),
        "date": analysis_date.isoformat(),
        "golden_cross_recent": golden_cross_recent,
        "golden_cross_date": golden_cross_date.isoformat() if golden_cross_date else None,
        "days_since_cross": days_since_cross,
        "sma50": round(sma50_value, 2),
        "sma200": round(sma200_value, 2),
        "rsi14": round(rsi_value, 1),
        "rsi_oversold": rsi_oversold,
        "stochastic_bullish": stochastic_bullish,
        "rvol": round(rvol_value, 2),
        "rvol_gt_2": rvol_gt_2,
        "buy": buy_signal,
        "failed_conditions": failed_conditions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze BUY signal for a stock ticker.")
    parser.add_argument("ticker", help="Ticker symbol (e.g., AAPL)")
    args = parser.parse_args()
    result = analyze(args.ticker)
    print(json.dumps(result, indent=2))
    return 0 if "error" not in result else 1


if __name__ == "__main__":
    sys.exit(main())
