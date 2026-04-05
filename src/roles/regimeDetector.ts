// Module responsibility: lightweight local regime hint for strategy diagnostics.
// It is not the system-level routing brain; ArchitectService owns family recommendations.

class RegimeDetector {
  detect(prices: number[]) {
    if (!Array.isArray(prices) || prices.length < 20) {
      return "warming";
    }

    const start = prices[Math.max(0, prices.length - 20)];
    const end = prices[prices.length - 1];
    const slope = start > 0 ? ((end - start) / start) * 100 : 0;
    let max = prices[prices.length - 20];
    let min = max;
    for (let index = Math.max(0, prices.length - 20); index < prices.length; index += 1) {
      const price = prices[index];
      if (price > max) max = price;
      if (price < min) min = price;
    }
    const rangePct = min > 0 ? ((max - min) / min) * 100 : 0;

    if (slope > 1.2) return "trend";
    if (slope < -1.5) return "bear";
    if (rangePct > 4.5) return "breakout";
    return "range";
  }
}

module.exports = {
  RegimeDetector
};
