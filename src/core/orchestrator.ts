// Module responsibility: compose the whole multi-bot system and run it as the main controller.

const { ConfigLoader } = require("./configLoader.ts");
const { BotManager } = require("./botManager.ts");
const { SystemServer } = require("./systemServer.ts");
const { StrategyRegistry } = require("./strategyRegistry.ts");
const { WSManager } = require("./wsManager.ts");
const { IndicatorEngine } = require("../engines/indicatorEngine.ts");
const { ExecutionEngine } = require("../engines/executionEngine.ts");
const { BacktestEngine } = require("../engines/backtestEngine.ts");
const { MarketStream } = require("../streams/marketStream.ts");
const { UserStream } = require("../streams/userStream.ts");
const { RiskManager } = require("../roles/riskManager.ts");
const { PerformanceMonitor } = require("../roles/performanceMonitor.ts");
const { StrategySwitcher } = require("../roles/strategySwitcher.ts");
const { RegimeDetector } = require("../roles/regimeDetector.ts");
const { StateStore } = require("./stateStore.ts");
const { createLogger } = require("../utils/logger.ts");
const { formatDuration, now, sleep } = require("../utils/time.ts");

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, value] = item.slice(2).split("=");
    args.set(key, value ?? "true");
  }
  return {
    durationMs: args.has("duration-ms") ? Number(args.get("duration-ms")) : null,
    summaryEveryMs: args.has("summary-ms") ? Number(args.get("summary-ms")) : 5000
  };
}

async function startOrchestrator(runtimeOptions: { durationMs?: number | null; summaryEveryMs?: number | null; serverEnabled?: boolean; port?: number | null } = {}) {
  const startedAt = now();
  const cliArgs = parseArgs(process.argv.slice(2));
  const cli = {
    durationMs: runtimeOptions.durationMs ?? cliArgs.durationMs,
    summaryEveryMs: runtimeOptions.summaryEveryMs ?? cliArgs.summaryEveryMs
  };
  const store = new StateStore({ maxEvents: 300, maxPriceHistory: 300 });
  const logger = createLogger("orchestrator", {
    eventSink: (event: any) => store.appendEvent(event)
  });
  const configLoader = new ConfigLoader();
  const botConfig = configLoader.loadBotsConfig();
  const marketMode = ((process.env.MARKET_MODE || botConfig.marketMode || botConfig.market?.mode || "mock") as string).toLowerCase();
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
  const performanceMonitor = new PerformanceMonitor();
  const strategySwitcher = new StrategySwitcher();
  const regimeDetector = new RegimeDetector();
  const executionEngine = new ExecutionEngine({ feeRate: 0.001, logger: logger.child("execution"), store, userStream });
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
  const systemServer = new SystemServer({
    feedMode: marketMode === "live" ? "live" : "mock",
    host: process.env.HOST || "127.0.0.1",
    logger,
    port: runtimeOptions.port ?? Number(process.env.PORT || 3000),
    publicDir: require("node:path").resolve(process.cwd(), "public"),
    startedAt,
    store
  });

  const botManager = new BotManager({
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
  botManager.startAll();
  await userStream.start({
    enabled: marketMode === "live"
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
    marketMode,
    strategies: strategyRegistry.listStrategyIds().join(",")
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    botManager.stopAll();
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
  startOrchestrator
};
