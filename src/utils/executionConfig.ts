type FeeRateSource = "FEE_BPS" | "ENTRY_FEE_BPS" | "EXIT_FEE_BPS" | "default";

function parseFeeBps(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(parsed, 0);
}

function resolveFeeRateFromEnv(env: Record<string, unknown> = process.env): {
  feeBps: number;
  feeRate: number;
  source: FeeRateSource;
} {
  const candidates: Array<FeeRateSource> = ["FEE_BPS", "ENTRY_FEE_BPS", "EXIT_FEE_BPS"];
  for (const source of candidates) {
    const feeBps = parseFeeBps(env[source]);
    if (feeBps === null) continue;
    return {
      feeBps,
      feeRate: feeBps / 10_000,
      source
    };
  }

  const feeBps = 10;
  return {
    feeBps,
    feeRate: feeBps / 10_000,
    source: "default"
  };
}

module.exports = {
  resolveFeeRateFromEnv
};
