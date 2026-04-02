// Module responsibility: compose the whole multi-bot system and run it as the main controller.

require("dotenv").config();

const { ConfigLoader } = require("./configLoader.ts");
const { BotManager } = require("./botManager.ts");
const { SystemServer } = require("./systemServer.ts");
const { StrategyRegistry } = require("./strategyRegistry.ts");
const { WSManager } = require("./wsManager.ts");
const { IndicatorEngine } = require("../engines/indicatorEngine.ts");
const { ExecutionEngine } = require("../engines/executionEngine.ts");
const { BacktestEngine } = require("../engines/backtestEngine.ts");
const { ContextService } = require("./contextService.ts");
const { ArchitectService } = require("./architectService.ts");
const { MarketStream } = require("../streams/marketStream.ts");
const { UserStream } = require("../streams/userStream.ts");
const { ContextBuilder } = require("../roles/contextBuilder.ts");
const { RiskManager } = require("../roles/riskManager.ts");
const { PerformanceMonitor } = require("../roles/performanceMonitor.ts");
const { StrategySwitcher } = require("../roles/strategySwitcher.ts");
const { RegimeDetector } = require("../roles/regimeDetector.ts");
const { BotArchitect } = require("../roles/botArchitect.ts");
const { StateStore } = require("./stateStore.ts");
const { createLogger } = require("../utils/logger.ts");
const { formatDuration, now, sleep } = require("../utils/time.ts");

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const normalized = item.slice(2);
    if (!normalized) continue;

    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex >= 0) {
      const key = normalized.slice(0, equalsIndex);
      const value = normalized.slice(equalsIndex + 1);
      args.set(key, value || "true");
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args.set(normalized, next);
      index += 1;
      continue;
    }

    args.set(normalized, "true");
  }

  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = args.get(key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  };

  return {
    durationMs: pick("duration-ms", "durationMs") ? Number(pick("duration-ms", "durationMs")) : null,
    executionMode: pick("execution-mode", "executionMode"),
    marketMode: pick("market-mode", "marketMode"),
    summaryEveryMs: pick("summary-ms", "summaryMs") ? Number(pick("summary-ms", "summaryMs")) : 5000
  };
}

async function startOrchestrator(runtimeOptions: { durationMs?: number | null; summaryEveryMs?: number | null; serverEnabled?: boolean; port?: number | null } = {}) {
  const startedAt = now();
  const cliArgs = parseArgs(process.argv.slice(2));
  const cli = {
    durationMs: runtimeOptions.durationMs ?? cliArgs.durationMs,
    summaryEveryMs: runtimeOptions.summaryEveryMs ?? cliArgs.summaryEveryMs
  };
  const store = new StateStore({ maxEvents: 300, maxPriceHistory: 600 });
  const logger = createLogger("orchestrator", {
    eventSink: (event: any) => store.appendEvent(event)
  });
  const configLoader = new ConfigLoader();
  const botConfig = configLoader.loadBotsConfig();
  const marketModeSource = cliArgs.marketMode
    ? "cli"
    : process.env.MARKET_MODE
      ? "env"
      : botConfig.marketMode || botConfig.market?.mode
        ? "config"
        : "default";
  const marketMode = ((cliArgs.marketMode || process.env.MARKET_MODE || botConfig.marketMode || botConfig.market?.mode || "mock") as string).toLowerCase();
  const executionModeSource = cliArgs.executionMode
    ? "cli"
    : process.env.EXECUTION_MODE
      ? "env"
      : botConfig.executionMode
        ? "config"
        : "paper_trading_fallback";
  const requestedExecutionMode = ((cliArgs.executionMode || process.env.EXECUTION_MODE || botConfig.executionMode || (String(process.env.PAPER_TRADING || "true").toLowerCase() === "false" ? "live" : "paper")) as string).toLowerCase();
  const executionMode = requestedExecutionMode === "live" ? "paper" : "paper";
  const simulatedExecutionOnly = executionMode === "paper";
  if (requestedExecutionMode !== executionMode) {
    logger.warn("execution_mode_forced_paper", {
      requestedExecutionMode,
      resolvedExecutionMode: executionMode,
      safety: "real_order_routing_not_implemented"
    });
  }
  const wsManager = new WSManager({
    logger: logger.child("ws")
  });
  const userStream = new UserStream({
    apiKey: process.env.BINANCE_API_KEY || null,
    logger: logger.child("user"),
    store,
    wsBaseUrl: botConfig.market?.wsBaseUrl || "wss://stream.binance.com:9443",
    wsManager
  });
  const indicatorEngine = new IndicatorEngine();
  const riskManager = new RiskManager();
  const tradeConstraints = riskManager.getTradeConstraints();
  const performanceMonitor = new PerformanceMonitor();
  const strategySwitcher = new StrategySwitcher();
  const regimeDetector = new RegimeDetector();
  const contextBuilder = new ContextBuilder({ indicatorEngine });
  const botArchitect = new BotArchitect();
  const executionEngine = new ExecutionEngine({
    executionMode,
    feeRate: 0.001,
    logger: logger.child("execution"),
    minTradeNotionalUsdt: tradeConstraints.minNotionalUsdt,
    minTradeQuantity: tradeConstraints.minQuantity,
    store,
    userStream
  });
  const backtestEngine = new BacktestEngine();
  const strategyRegistry = new StrategyRegistry({ configLoader, indicatorEngine });
  strategyRegistry.load();

  const enabledBots = (botConfig.bots || []).filter((bot: any) => bot.enabled);
  const marketStream = new MarketStream({
    intervalMs: botConfig.market?.mockIntervalMs || 1000,
    klineIntervals: botConfig.market?.klineIntervals || [],
    liveEmitIntervalMs: botConfig.market?.liveEmitIntervalMs || 1000,
    logger: logger.child("market"),
    mode: marketMode === "live" ? "live" : "mock",
    restExchangeId: botConfig.market?.provider || "binance",
    streamType: botConfig.market?.streamType || "trade",
    store,
    wsBaseUrl: botConfig.market?.wsBaseUrl || "wss://stream.binance.com:9443",
    wsManager
  });
  const contextService = new ContextService({
    contextBuilder,
    logger: logger.child("context"),
    marketStream,
    maxWindowMs: 300_000,
    store,
    warmupMs: 30_000
  });
  const architectService = new ArchitectService({
    botArchitect,
    logger: logger.child("architect"),
    marketStream,
    publishIntervalMs: 30_000,
    requiredConfirmations: 2,
    store,
    switchDelta: 0.12,
    warmupMs: 30_000
  });
  const systemServer = new SystemServer({
    executionMode,
    feedMode: marketMode === "live" ? "live" : "mock",
    host: process.env.HOST || "127.0.0.1",
    logger,
    port: runtimeOptions.port ?? Number(process.env.PORT || 3000),
    publicDir: require("node:path").resolve(process.cwd(), "public"),
    startedAt,
    store
  });

  const botManager = new BotManager({
    botArchitect,
    executionEngine,
    indicatorEngine,
    logger: logger.child("bots"),
    marketStream,
    performanceMonitor,
    regimeDetector,
    riskManager,
    stateStore: store,
    store,
    strategyRegistry,
    strategySwitcher
  });

  botManager.initialize(enabledBots);
  marketStream.start(enabledBots.map((bot: any) => bot.symbol));
  contextService.start(enabledBots.map((bot: any) => bot.symbol));
  architectService.start(enabledBots.map((bot: any) => bot.symbol));
  botManager.startAll();
  await userStream.start({
    enabled: executionMode === "live",
    mode: executionMode === "live" ? "live" : "mock",
    reason: executionMode === "paper" ? "paper_execution" : "execution_enabled"
  });
  if (runtimeOptions.serverEnabled !== false) {
    systemServer.start();
  }

  userStream.subscribe((payload: any) => {
    logger.info("user_stream_event", {
      botId: payload.order?.botId || "n/a",
      side: payload.order?.side || "n/a",
      symbol: payload.order?.symbol || "n/a",
      type: payload.type || "unknown"
    });
  });

  logger.info("system_ready", {
    backtestEngine: backtestEngine.run().ok,
    bots: enabledBots.length,
    executionMode,
    executionSafety: simulatedExecutionOnly ? "simulated_only" : "exchange_execution_enabled",
    marketMode,
    marketModeSource,
    requestedExecutionMode,
    requestedExecutionModeSource: executionModeSource,
    strategies: strategyRegistry.listStrategyIds().join(",")
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    botManager.stopAll();
    architectService.stop();
    contextService.stop();
    marketStream.stop();
    Promise.resolve(userStream.stop()).catch(() => {});
    if (runtimeOptions.serverEnabled !== false) {
      systemServer.stop();
    }
    wsManager.closeAll();
    logger.info("system_stopped");
  };

  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  while (!stopped) {
    const snapshot = store.getSystemSnapshot();
    logger.info("heartbeat", {
      botsRunning: snapshot.botStates.filter((bot: any) => bot.status === "running").length,
      openPositions: snapshot.openPositions.length,
      symbols: snapshot.latestPrices.map((entry: any) => `${entry.symbol}:${entry.price.toFixed(2)}`).join(", ")
    });

    if (cli.durationMs && now() - startedAt >= cli.durationMs) {
      logger.info("duration_reached", { duration: formatDuration(now() - startedAt) });
      break;
    }

    await sleep(cli.summaryEveryMs);
  }

  stop();
}

if (require.main === module) {
  startOrchestrator().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  startOrchestrator
};
