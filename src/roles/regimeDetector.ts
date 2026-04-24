// It is not the system-level routing brain; ArchitectService owns family recommendations.

const RECENT_WINDOW_SIZE = 20;
// Intentional asymmetric drift thresholds: upside drift routes to trend diagnostics earlier,
// while downside drift requires a larger move before labeling the local hint as bear.
const TREND_UP_SLOPE_PCT = 1.2;
const BEAR_DOWN_SLOPE_PCT = -1.5;
const BREAKOUT_RANGE_PCT = 4.5;

class RegimeDetector {
  detect(prices: number[]) {
    if (!Array.isArray(prices) || prices.length < RECENT_WINDOW_SIZE) {
      return "warming";
    }

    const startIndex = Math.max(0, prices.length - RECENT_WINDOW_SIZE);
    const start = prices[startIndex];
    const end = prices[prices.length - 1];
    const slope = start > 0 ? ((end - start) / start) * 100 : 0;
    let max = prices[startIndex];
    let min = max;
    for (let index = startIndex; index < prices.length; index += 1) {
      const price = prices[index];
      if (price > max) max = price;
      if (price < min) min = price;
    }
    const rangePct = min > 0 ? ((max - min) / min) * 100 : 0;

    if (slope > TREND_UP_SLOPE_PCT) return "trend";
    if (slope < BEAR_DOWN_SLOPE_PCT) return "bear";
    if (rangePct > BREAKOUT_RANGE_PCT) return "breakout";
    return "range";
  }
}

module.exports = {
  RegimeDetector
};
