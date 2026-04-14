require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { BacktestEngine } = require("../src/engines/backtestEngine.ts");

function parseSymbols(rawValue) {
  if (!rawValue || typeof rawValue !== "string") {
    return [];
  }

  const normalizedValue = rawValue.trim().replace(/^['"]|['"]$/g, "");
  if (!normalizedValue) {
    return [];
  }

  return [...new Set(
    normalizedValue
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean)
  )];
}

function buildConfig() {
  return {
    AGGRESSIVE_EDGE_MULT: Math.max(Number(process.env.AGGRESSIVE_EDGE_MULT || 0.72), 0.1),
    AGGRESSIVE_ENTRY_MIN_SCORE_DELTA: Math.max(Number(process.env.AGGRESSIVE_ENTRY_MIN_SCORE_DELTA || 1), 0),
    AGGRESSIVE_ENTRY_VOLUME_DELTA: Math.max(Number(process.env.AGGRESSIVE_ENTRY_VOLUME_DELTA || 0.15), 0),
    AGGRESSIVE_MODE_ENABLED: (process.env.AGGRESSIVE_MODE_ENABLED || "false").toLowerCase() === "true",
    AGGRESSIVE_RANGE_RSI_BONUS: Math.max(Number(process.env.AGGRESSIVE_RANGE_RSI_BONUS || 6), 0),
    AGGRESSIVE_RISK_REWARD_MULT: Math.max(Number(process.env.AGGRESSIVE_RISK_REWARD_MULT || 0.85), 0.1),
    AGGRESSIVE_TREND_SLOPE_MULT: Math.max(Number(process.env.AGGRESSIVE_TREND_SLOPE_MULT || 0.65), 0.1),
    ATR_PERIOD: 14,
    ATR_STOP_MULT: Number(process.env.ATR_STOP_MULT || 1.5),
    ATR_TP_MULT: Number(process.env.ATR_TP_MULT || 3.0),
    ATR_TRAIL_MULT: Number(process.env.ATR_TRAIL_MULT || 2.0),
    BACKTEST_BTC_FILTER_ENABLED: (process.env.BACKTEST_BTC_FILTER_ENABLED || process.env.BTC_FILTER_ENABLED || "true").toLowerCase() === "true",
    BACKTEST_DAYS: Math.max(Number(process.env.BACKTEST_DAYS || 3), 1),
    BACKTEST_FETCH_BATCH_SIZE: Math.max(Number(process.env.BACKTEST_FETCH_BATCH_SIZE || 2), 1),
    BACKTEST_FETCH_DELAY_MS: Math.max(Number(process.env.BACKTEST_FETCH_DELAY_MS || 800), 0),
    BACKTEST_REPORT_FILE: path.join(process.cwd(), "backtest-report.json"),
    BACKTEST_SYMBOL_LIMIT: Math.max(Number(process.env.BACKTEST_SYMBOL_LIMIT || 6), 1),
    DYNAMIC_QUOTE_PRIORITY: new Map([["USDT", 0], ["USDC", 1], ["FDUSD", 2]]),
    EMA20_1H_PERIOD: 20,
    EMA21_5M_PERIOD: 21,
    EMA50_1H_PERIOD: 50,
    EMA9_1M_PERIOD: 9,
    EMA9_5M_PERIOD: 9,
    ENTRY_FEE_BPS: Math.max(Number(process.env.ENTRY_FEE_BPS || process.env.FEE_BPS || 10), 0),
    ENTRY_VOLUME_MULT: Number(process.env.ENTRY_VOLUME_MULT || 0.8),
    EXCHANGE_ID: process.env.EXCHANGE || "binance",
    EXCLUDED_BASE_ASSETS: new Set(["USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDP", "EUR", "GBP", "WBTC", "WETH", "STETH", "WSTETH", "RETH", "USD1", "U", "NOM", "NIGHT", "STO", "SENT", "ANKR", "BARD", "KITE", "CFG"]),
    EXIT_FEE_BPS: Math.max(Number(process.env.EXIT_FEE_BPS || process.env.FEE_BPS || 10), 0),
    FETCH_LIMIT_1H: Math.max(Number(process.env.FETCH_LIMIT_1H || 140), 80),
    FETCH_LIMIT_1M: Math.max(Number(process.env.FETCH_LIMIT_1M || 160), 80),
    FETCH_LIMIT_5M: Math.max(Number(process.env.FETCH_LIMIT_5M || 220), 120),
    FETCH_TIMEOUT_MS: Math.max(Number(process.env.FETCH_TIMEOUT_MS || 15000), 1000),
    FOCUS_MIN_SCORE: Math.max(Number(process.env.FOCUS_MIN_SCORE || 4), 0),
    HARD_STOP_PCT: Number(process.env.HARD_STOP_PCT || 0.05),
    HOT_SYMBOLS_POOL_COUNT: Math.max(Number(process.env.HOT_SYMBOLS_POOL_COUNT || 30), 10),
    INITIAL_USDT_BALANCE: Number(process.env.INITIAL_USDT_BALANCE || 100),
    LEVERAGED_TOKEN_REGEX: /\d+[LS]$/i,
    LOSS_COOLDOWN_CYCLES: Math.max(Number(process.env.LOSS_COOLDOWN_CYCLES || 8), 0),
    MACD_FAST: Number(process.env.MACD_FAST || 12),
    MACD_SIGNAL: Number(process.env.MACD_SIGNAL || 9),
    MACD_SLOW: Number(process.env.MACD_SLOW || 26),
    MAX_CONCURRENT_POSITIONS: Number(process.env.MAX_CONCURRENT_POSITIONS || 3),
    MAX_POSITION_EXPOSURE_PCT: 0.85,
    MIN_EXPECTED_NET_EDGE_BPS: Math.max(Number(process.env.MIN_EXPECTED_NET_EDGE_BPS || 25), 0),
    MIN_HOLD_CANDLES: Math.max(Number(process.env.MIN_HOLD_CANDLES || 5), 1),
    MIN_HOLD_SECONDS: 0,
    MIN_POSITION_NOTIONAL_USDT: Math.max(Number(process.env.MIN_POSITION_NOTIONAL_USDT || 10), 1),
    MIN_RISK_REWARD_RATIO: Math.max(Number(process.env.MIN_RISK_REWARD_RATIO || 1.8), 0),
    MIN_SCORE_ENTRY: Number(process.env.MIN_SCORE_ENTRY || 6),
    MIN_TAKE_PROFIT_BPS: Math.max(Number(process.env.MIN_TAKE_PROFIT_BPS || 35), 1),
    NEUTRAL_TOP_N: Math.max(Number(process.env.NEUTRAL_TOP_N || 10), 1),
    PARTIAL_TP_R: Math.max(Number(process.env.PARTIAL_TP_R || 1.5), 0),
    POLL_INTERVAL_MS: 0,
    POSITION_SIZE_MAX: Number(process.env.POSITION_SIZE_MAX || 0.4),
    POSITION_SIZE_MIN: Number(process.env.POSITION_SIZE_MIN || 0.2),
    RANGE_BB_PERIOD: Math.max(Number(process.env.RANGE_BB_PERIOD || 20), 10),
    RANGE_BB_STDDEV: Math.max(Number(process.env.RANGE_BB_STDDEV || 2), 1),
    RANGE_EMA_GAP_MAX: Math.max(Number(process.env.RANGE_EMA_GAP_MAX || 0.006), 0.0001),
    RANGE_ENTRY_MIN_SCORE: Math.max(Number(process.env.RANGE_ENTRY_MIN_SCORE || process.env.MIN_SCORE_ENTRY || 6), Number(process.env.MIN_SCORE_ENTRY || 6)),
    RANGE_RSI_MAX: Math.max(Number(process.env.RANGE_RSI_MAX || 40), 1),
    RANGE_SLOPE_MAX: Math.max(Number(process.env.RANGE_SLOPE_MAX || 0.0009), 0.00001),
    RISK_PCT_PER_TRADE: Math.max(Number(process.env.RISK_PCT_PER_TRADE || 0.01), 0),
    RSI_MAX: Number(process.env.RSI_MAX || 62),
    RSI_MIN: Number(process.env.RSI_MIN || 42),
    RSI_PERIOD: Number(process.env.RSI_PERIOD || 14),
    SFP_ENTRY_MIN_SCORE: Math.max(Number(process.env.SFP_ENTRY_MIN_SCORE || process.env.MIN_SCORE_ENTRY || 7), Number(process.env.MIN_SCORE_ENTRY || 6)),
    SLIPPAGE_BPS_BASE: Math.max(Number(process.env.SLIPPAGE_BPS_BASE || 5), 0),
    SPREAD_MAX_PCT: Math.max(Number(process.env.SPREAD_MAX_PCT || 0.001), 0),
    STRATEGY_MODE: "adaptive",
    TARGET_NET_EDGE_BPS_FOR_MAX_SIZE: Math.max(Number(process.env.TARGET_NET_EDGE_BPS_FOR_MAX_SIZE || 120), 1),
    TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE: Math.max(Number(process.env.TARGET_RISK_REWARD_RATIO_FOR_MAX_SIZE || 3), 1),
    TIME_STOP_CANDLES: Math.max(Number(process.env.TIME_STOP_CANDLES || 12), 1),
    TOP_SYMBOLS_COUNT: Math.max(Number(process.env.TOP_SYMBOLS_COUNT || 10), 1),
    TRADES_LOG_FILE: path.join(process.cwd(), "trades.log"),
    TRAILING_PCT: Number(process.env.TRAILING_PCT || 0.007),
    TREND_ENTRY_MIN_SCORE: Math.max(Number(process.env.TREND_ENTRY_MIN_SCORE || process.env.MIN_SCORE_ENTRY || 7), Number(process.env.MIN_SCORE_ENTRY || 6)),
    TREND_SLOPE_MIN: Number(process.env.TREND_SLOPE_MIN || 0.001),
    VOLUME_MULT: Number(process.env.VOLUME_MULT || 1.15),
    VOLUME_SMA_PERIOD: 20,
    WEAK_SYMBOL_RSI_MAX: Number(process.env.WEAK_SYMBOL_RSI_MAX || 45)
  };
}

async function main() {
  const backtestEngine = new BacktestEngine();
  const config = buildConfig();
  const activeSymbols = parseSymbols(process.env.BACKTEST_SYMBOLS || process.env.SYMBOLS);
  const report = await backtestEngine.runJob({
    activeSymbols,
    baseConfig: config,
    hotPool: [],
    log: (message) => console.log(message),
    request: {
      aggressiveMode: config.AGGRESSIVE_MODE_ENABLED,
      symbols: activeSymbols.join(","),
      useActiveWatchlist: activeSymbols.length > 0
    }
  });

  fs.writeFileSync(config.BACKTEST_REPORT_FILE, JSON.stringify(report, null, 2));
  backtestEngine.printReport(report);
  console.log(`Saved report to ${config.BACKTEST_REPORT_FILE}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
