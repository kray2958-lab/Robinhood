#!/usr/bin/env python3
"""Evaluate SELL signal from bearish trend, momentum, and volume indicators."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

# Hourly chart: more bar movement than daily, so crossovers trigger more often.
CHART_INTERVAL = "1h"
LOOKBACK_PERIOD = "60d"
MIN_BARS = 250
BARS_PER_TRADING_DAY = 7  # US regular-session hours (approx)
DEATH_CROSS_LOOKBACK = 5 * BARS_PER_TRADING_DAY
STOCH_LOOKBACK = 3 * BARS_PER_TRADING_DAY
RSI_FADE_LOOKBACK = 10 * BARS_PER_TRADING_DAY


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
        period=LOOKBACK_PERIOD,
        interval=CHART_INTERVAL,
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

    if len(frame) < MIN_BARS:
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


def detect_bearish_crossover(
    fast: pd.Series, slow: pd.Series, lookback_bars: int
) -> tuple[bool, date | None, int | None]:
    for i in range(1, lookback_bars + 1):
        if len(fast) <= i or len(slow) <= i:
            break
        fast_today = fast.iloc[-i]
        slow_today = slow.iloc[-i]
        fast_prev = fast.iloc[-i - 1]
        slow_prev = slow.iloc[-i - 1]
        if pd.isna(fast_today) or pd.isna(slow_today) or pd.isna(fast_prev) or pd.isna(slow_prev):
            continue
        if fast_today < slow_today and fast_prev >= slow_prev:
            cross_date = fast.index[-i].date()
            bars_since = i - 1
            return True, cross_date, bars_since
    return False, None, None


def detect_rsi_bearish_fade(
    rsi_series: pd.Series, lookback_bars: int = RSI_FADE_LOOKBACK
) -> bool:
    """True if RSI touched >= 80, then crossed below 70 within lookback bars."""
    for i in range(1, lookback_bars + 1):
        if len(rsi_series) <= i:
            break
        curr = rsi_series.iloc[-i]
        prev = rsi_series.iloc[-i - 1]
        if pd.isna(curr) or pd.isna(prev):
            continue
        if curr < 70 and prev >= 70:
            start = max(0, len(rsi_series) - i - lookback_bars)
            before_cross = rsi_series.iloc[start:-i]
            if not before_cross.empty and (before_cross >= 80).any():
                return True
    return False


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

    death_cross_recent, death_cross_date, days_since_cross = detect_bearish_crossover(
        sma50, sma200, DEATH_CROSS_LOOKBACK
    )
    stochastic_bearish, _, _ = detect_bearish_crossover(percent_k, percent_d, STOCH_LOOKBACK)

    rsi_overbought = detect_rsi_bearish_fade(rsi14)
    rvol_gt_2 = rvol_value > 2.0
    sell_signal = death_cross_recent and rsi_overbought and stochastic_bearish and rvol_gt_2

    failed_conditions: list[str] = []
    if not death_cross_recent:
        failed_conditions.append(
            f"Death Cross did not occur within last {DEATH_CROSS_LOOKBACK} hourly bars "
            f"(~5 trading days)"
        )
    if not rsi_overbought:
        failed_conditions.append(
            f"RSI(14) did not fade from >=80 and cross below 70 "
            f"within last {RSI_FADE_LOOKBACK} hourly bars (latest {rsi_value:.1f})"
        )
    if not stochastic_bearish:
        failed_conditions.append(
            f"%K did not cross below %D within last {STOCH_LOOKBACK} hourly bars (~3 trading days)"
        )
    if not rvol_gt_2:
        failed_conditions.append(f"RVOL not above 2.0 ({rvol_value:.2f})")

    return {
        "ticker": ticker.upper().strip(),
        "date": analysis_date.isoformat(),
        "chart_interval": CHART_INTERVAL,
        "death_cross_recent": death_cross_recent,
        "death_cross_date": death_cross_date.isoformat() if death_cross_date else None,
        "days_since_cross": days_since_cross,
        "sma50": round(sma50_value, 2),
        "sma200": round(sma200_value, 2),
        "rsi14": round(rsi_value, 1),
        "rsi_overbought": rsi_overbought,
        "stochastic_bearish": stochastic_bearish,
        "rvol": round(rvol_value, 2),
        "rvol_gt_2": rvol_gt_2,
        "sell": sell_signal,
        "failed_conditions": failed_conditions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze SELL signal for a stock ticker.")
    parser.add_argument("ticker", help="Ticker symbol (e.g., AAPL)")
    args = parser.parse_args()
    result = analyze(args.ticker)
    print(json.dumps(result, indent=2))
    return 0 if "error" not in result else 1


if __name__ == "__main__":
    sys.exit(main())
