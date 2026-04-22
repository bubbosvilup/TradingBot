// Module responsibility: shared indicator calculations used by all strategies.

import type { IndicatorSnapshot } from "../types/strategy.ts";

const { mean, stddev } = require("../utils/math.ts");

class IndicatorEngine {
  ema(values: number[], period: number): number | null {
    if (!Array.isArray(values) || values.length < period || period <= 1) {
      return null;
    }

    const multiplier = 2 / (period + 1);
    let emaValue = mean(values.slice(0, period));
    for (const value of values.slice(period)) {
      emaValue = ((value - emaValue) * multiplier) + emaValue;
    }
    return emaValue;
  }

  rsi(values: number[], period: number): number | null {
    if (!Array.isArray(values) || values.length <= period) {
      return null;
    }

    // This is a simple-window RSI, not Wilder-smoothed RSI; strategy thresholds are calibrated to this exact implementation.
    let gains = 0;
    let losses = 0;
    for (let index = values.length - period; index < values.length; index += 1) {
      const change = values[index] - values[index - 1];
      if (change >= 0) gains += change;
      else losses += Math.abs(change);
    }

    if (losses === 0) return 100;
    const relativeStrength = gains / losses;
    return 100 - (100 / (1 + relativeStrength));
  }

  momentum(values: number[], lookback: number = 5): number | null {
    if (values.length <= lookback) return null;
    return values[values.length - 1] - values[values.length - 1 - lookback];
  }

  volatility(values: number[], period: number = 20): number | null {
    if (values.length < period) return null;
    return stddev(values.slice(-period));
  }

  createSnapshot(values: number[], settings: { emaFast?: number; emaSlow?: number; emaBaseline?: number; rsiPeriod?: number } = {}): IndicatorSnapshot {
    return {
      emaFast: this.ema(values, settings.emaFast || 9),
      emaSlow: this.ema(values, settings.emaSlow || 21),
      emaBaseline: this.ema(values, settings.emaBaseline || 50),
      momentum: this.momentum(values, 5),
      rsi: this.rsi(values, settings.rsiPeriod || 14),
      volatility: this.volatility(values, 20)
    };
  }
}

module.exports = {
  IndicatorEngine
};
