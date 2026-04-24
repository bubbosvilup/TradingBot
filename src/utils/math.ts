function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function round(value: number, decimals: number = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

module.exports = {
  clamp,
  mean,
  round,
  stddev,
  sum
};

