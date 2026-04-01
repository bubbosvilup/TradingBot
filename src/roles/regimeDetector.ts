// Module responsibility: lightweight market regime classification for strategy context and switching.

class RegimeDetector {
  detect(prices: number[]) {
    if (!Array.isArray(prices) || prices.length < 20) {
      return "warming";
    }

    const start = prices[Math.max(0, prices.length - 20)];
    const end = prices[prices.length - 1];
    const slope = start > 0 ? ((end - start) / start) * 100 : 0;
    const window = prices.slice(-20);
    const max = Math.max(...window);
    const min = Math.min(...window);
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

