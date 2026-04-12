// Module responsibility: compose the whole multi-bot system and run it as the main controller.

require("dotenv").config();

const { ConfigLoader } = require("./configLoader.ts");
const { BotManager } = require("./botManager.ts");
const { SystemServer } = require("./systemServer.ts");
const { StrategyRegistry } = require("./strategyRegistry.ts");
const { WSManager } = require("./wsManager.ts");
const { IndicatorEngine } = require("../engines/indicatorEngine.ts");
const { ExecutionEngine } = require("../engines/executionEngine.ts");
const { ContextService } = require("./contextService.ts");
const { MtfContextService } = require("./mtfContextService.ts");
const { ArchitectService } = require("./architectService.ts");
const { HistoricalBootstrapService } = require("./historicalBootstrapService.ts");
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
const { resolveFeeRateFromEnv } = require("../utils/executionConfig.ts");
const { formatDuration, now, sleep } = require("../utils/time.ts");
const { ExperimentReporter } = require("./experimentReporter.ts");

function parseOptionalBooleanFlag(value: string | undefined | null, name: string) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name}=${value} is invalid; expected true/false, 1/0, yes/no, or on/off`);
}

function resolveMtfRuntimeConfig(config: any, env: NodeJS.ProcessEnv = process.env) {
  const baseMtfConfig = config?.mtf || {};
  const envEnabled = parseOptionalBooleanFlag(env.MTF_ENABLED, "MTF_ENABLED");
  const configEnabled = baseMtfConfig.enabled === undefined ? false : Boolean(baseMtfConfig.enabled);
  return {
    config: {
      ...baseMtfConfig,
      enabled: envEnabled === null ? configEnabled : envEnabled
    },
    enabledSource: envEnabled === null
      ? (baseMtfConfig.enabled === undefined ? "default_disabled" : "config")
      : "env"
  };
}

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

function isEnabledFlag(value: string | undefined) {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function resolvePaperOnlyExecutionMode(cliArgs: { executionMode?: string | null }, botConfig: { executionMode?: string | null }) {
  const paperTradingEnv = process.env.PAPER_TRADING;
  const requestedExecutionMode = cliArgs.executionMode !== null && cliArgs.executionMode !== undefined && cliArgs.executionMode !== ""
    ? String(cliArgs.executionMode).toLowerCase()
    : process.env.EXECUTION_MODE
      ? String(process.env.EXECUTION_MODE).toLowerCase()
      : botConfig.executionMode
        ? String(botConfig.executionMode).toLowerCase()
        : "paper";
  const executionModeSource = cliArgs.executionMode
    ? "cli"
    : process.env.EXECUTION_MODE
      ? "env"
      : botConfig.executionMode
        ? "config"
        : "runtime_paper_only";

  if (paperTradingEnv !== undefined && String(paperTradingEnv).toLowerCase() === "false") {
    throw new Error("PAPER_TRADING=false is not supported; active runtime is paper-only and live execution remains gated for future live-readiness work");
  }

  if (requestedExecutionMode === "live") {
    throw new Error("execution-mode=live is not supported; active runtime is paper-only and live execution remains gated for future live-readiness work");
  }

  if (requestedExecutionMode !== "paper") {
    throw new Error(`execution-mode=${requestedExecutionMode} is invalid; active runtime only supports execution-mode=paper`);
  }

  return {
    executionMode: "paper" as const,
    executionModeSource,
    requestedExecutionMode
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
  const architectWarmupMs = Math.max(Number(botConfig.architectWarmupMs) || 30_000, 5_000);
  const architectPublishIntervalMs = Math.max(Number(botConfig.architectPublishIntervalMs) || 30_000, 5_000);
  const contextMaxWindowMs = 300_000;
  const postLossLatchMinFreshPublications = Math.max(Number(botConfig.postLossLatchMinFreshPublications) || 2, 1);
  const symbolStateRetentionMs = Math.max(Number(botConfig.symbolStateRetentionMs) || (30 * 60 * 1000), 60_000);
  store.setSymbolStateRetentionMs(symbolStateRetentionMs);
  store.setPortfolioKillSwitchConfig(botConfig.portfolioKillSwitch || null);
  const loggingMode = String(botConfig.loggingMode || process.env.LOGGING_MODE || process.env.LOG_TYPE || "normal").trim().replace(/^["']|["']$/g, "").toLowerCase();
  const isSilent = loggingMode === "silent";
  const marketModeSource = cliArgs.marketMode
    ? "cli"
    : process.env.MARKET_MODE
      ? "env"
      : botConfig.marketMode || botConfig.market?.mode
        ? "config"
        : "runtime_live_only";
  const requestedMarketMode = ((cliArgs.marketMode || process.env.MARKET_MODE || botConfig.marketMode || botConfig.market?.mode || "live") as string).toLowerCase();
  if (requestedMarketMode !== "live") {
    throw new Error(`market-mode=${requestedMarketMode} is not supported; startup aborted because the active runtime requires live market data`);
  }
  const marketMode: "live" = "live";
  const {
    executionMode,
    executionModeSource,
    requestedExecutionMode
  } = resolvePaperOnlyExecutionMode(cliArgs, botConfig);
  const simulatedExecutionOnly = executionMode === "paper";
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
  const executionFee = resolveFeeRateFromEnv();
  const performanceMonitor = new PerformanceMonitor();
  const regimeDetector = new RegimeDetector();
  const contextBuilder = new ContextBuilder({ indicatorEngine });
  const botArchitect = new BotArchitect();
  const resolvedMtf = resolveMtfRuntimeConfig(botConfig);
  const mtfConfig = resolvedMtf.config;
  const executionEngine = new ExecutionEngine({
    executionMode,
    feeRate: executionFee.feeRate,
    logger: logger.child("execution"),
    minTradeNotionalUsdt: tradeConstraints.minNotionalUsdt,
    minTradeQuantity: tradeConstraints.minQuantity,
    store,
    userStream
  });
  const strategyRegistry = new StrategyRegistry({ configLoader, indicatorEngine });
  strategyRegistry.load();
  const resolveStrategyFamily = (strategyId: string | null | undefined) => strategyRegistry.getStrategyFamily(strategyId);
  const strategySwitcher = new StrategySwitcher({ resolveStrategyFamily });

  const enabledBots = (botConfig.bots || [])
    .filter((bot: any) => bot.enabled)
    .map((bot: any) => ({
      ...bot,
      postLossArchitectLatchPublishesRequired: Number.isFinite(Number(bot.postLossArchitectLatchPublishesRequired))
        ? Math.max(Number(bot.postLossArchitectLatchPublishesRequired), 1)
        : postLossLatchMinFreshPublications
    }));
  const marketStream = new MarketStream({
    klineIntervals: botConfig.market?.klineIntervals || [],
    liveEmitIntervalMs: botConfig.market?.liveEmitIntervalMs,
    logger: logger.child("market"),
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
    maxWindowMs: contextMaxWindowMs,
    store,
    warmupMs: architectWarmupMs
  });
  const mtfContextService = mtfConfig.enabled
    ? new MtfContextService({
        architect: botArchitect,
        contextBuilder,
        store
      })
    : null;
  const architectService = new ArchitectService({
    botArchitect,
    logger: logger.child("architect"),
    marketStream,
    mtfConfig,
    mtfContextService,
    publishIntervalMs: architectPublishIntervalMs,
    requiredConfirmations: 2,
    store,
    switchDelta: 0.12,
    warmupMs: architectWarmupMs
  });
  const historicalBootstrapService = new HistoricalBootstrapService({
    architectWarmupMs,
    config: botConfig.historicalPreload || null,
    contextMaxWindowMs,
    logger: logger.child("preload"),
    marketKlineIntervals: botConfig.market?.klineIntervals || [],
    marketStream,
    mtfConfig,
    store
  });
  const systemServer = new SystemServer({
    architectWarmupMs,
    autoOpenCompactUi: isEnabledFlag(process.env.AUTO_OPEN_COMPACT_UI) || isEnabledFlag(process.env.COMPACT_UI),
    compactUiRoute: process.env.COMPACT_UI_ROUTE || "/compact",
    executionMode,
    feeRate: executionFee.feeRate,
    feedMode: "live",
    host: process.env.HOST || "127.0.0.1",
    logger,
    port: runtimeOptions.port ?? Number(process.env.PORT || 3000),
    publicDir: require("node:path").resolve(process.cwd(), "public"),
    resolveStrategyFamily,
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

  const enabledSymbols = enabledBots.map((bot: any) => bot.symbol);
  const historicalPreloadResult = await historicalBootstrapService.run(enabledSymbols, { observedAt: startedAt });
  botManager.initialize(enabledBots);
  marketStream.start(enabledSymbols);
  contextService.start(enabledSymbols);
  architectService.start(enabledSymbols);
  botManager.startAll();
  if (runtimeOptions.serverEnabled !== false) {
    systemServer.start();
  }

  userStream.subscribe((payload: any) => {
    if (!isSilent) {
      logger.info("user_stream_event", {
        botId: payload.order?.botId || "n/a",
        side: payload.order?.side || "n/a",
        symbol: payload.order?.symbol || "n/a",
        type: payload.type || "unknown"
      });
    }
  });

  if (!isSilent) {
    const portfolioKillSwitch = store.getPortfolioKillSwitchState({ feeRate: executionFee.feeRate, now: startedAt });
    logger.info("system_ready", {
      bots: enabledBots.length,
      executionMode,
      feeRate: executionFee.feeRate,
      feeRateBps: executionFee.feeBps,
      feeRateSource: executionFee.source,
      executionSafety: simulatedExecutionOnly ? "simulated_only" : "exchange_execution_enabled",
      marketMode,
      marketModeSource,
      architectPublishIntervalMs,
      architectWarmupMs,
      portfolioKillSwitchEnabled: portfolioKillSwitch.enabled,
      portfolioKillSwitchMaxDrawdownPct: portfolioKillSwitch.maxDrawdownPct,
      portfolioKillSwitchMode: portfolioKillSwitch.mode,
      mtfEnabled: Boolean(mtfConfig.enabled),
      mtfEnabledSource: resolvedMtf.enabledSource,
      mtfFrameCount: Array.isArray(mtfConfig.frames) ? mtfConfig.frames.length : 0,
      historicalPreloadEnabled: Boolean(historicalPreloadResult?.enabled),
      historicalPreloadOutcome: historicalPreloadResult?.outcome || "disabled",
      historicalPreloadRequired: Boolean(historicalPreloadResult?.required),
      historicalPreloadHorizonMs: historicalPreloadResult?.horizonMs || null,
      historicalPreloadDurationMs: historicalPreloadResult?.durationMs || 0,
      postLossLatchMinFreshPublications,
      symbolStateRetentionMs,
      userStreamRuntime: "paper_simulated_events_only",
      requestedExecutionMode,
      requestedExecutionModeSource: executionModeSource,
      strategies: strategyRegistry.listStrategyIds().join(",")
    });
  }

  const experimentConfig = botConfig.experimentMetrics || {};
  const experimentReporter = new ExperimentReporter({
    logger: logger.child("experiment"),
    store,
    config: {
      enabled: Boolean(experimentConfig.enabled),
      label: String(experimentConfig.label || "").trim() || "experiment",
      summaryIntervalMs: Math.max(Number(experimentConfig.summaryIntervalMs) || 60_000, 10_000)
    },
    loggingMode
  });

  if (experimentReporter.isEnabled() && !isSilent) {
    logger.info("experiment_enabled", {
      label: experimentReporter.getLabel(),
      summaryIntervalMs: experimentReporter.getSummaryIntervalMs()
    });
  }

  let stopped = false;
  let finalReportWritten = false;
  let lastExperimentCheckpointAt = startedAt;
  let userStreamStopPromise: Promise<void> | null = null;
  let gracefulStopPromise: Promise<void> | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    botManager.stopAll();
    architectService.stop();
    contextService.stop();
    marketStream.stop();
    userStreamStopPromise = Promise.resolve(userStream.stop()).catch(() => {});
    if (runtimeOptions.serverEnabled !== false) {
      systemServer.stop();
    }
    wsManager.closeAll();
    if (!isSilent) {
      logger.info("system_stopped");
    }
  };

  const writeFinalReport = () => {
    if (experimentReporter.isEnabled() && !finalReportWritten) {
      finalReportWritten = true;
      experimentReporter.logFinalSummary();
    }
  };

  const stopGracefully = async () => {
    if (gracefulStopPromise) return gracefulStopPromise;
    stop();
    gracefulStopPromise = (async () => {
      await (userStreamStopPromise || Promise.resolve());
      // Write final report AFTER shutdown completes
      writeFinalReport();
      // Small delay to ensure file is flushed before process.exit
      await new Promise((resolve) => setTimeout(resolve, 200));
    })();
    return gracefulStopPromise;
  };

  const handleShutdown = async () => {
    await stopGracefully();
  };

  process.on("SIGINT", () => {
    handleShutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((error: Error) => {
        console.error(error);
        process.exit(1);
      });
  });
  process.on("SIGTERM", () => {
    handleShutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((error: Error) => {
        console.error(error);
        process.exit(1);
      });
  });
  // Fallback: write report on any exit path
  process.on("beforeExit", () => {
    if (experimentReporter.isEnabled()) {
      writeFinalReport();
    }
  });

  while (!stopped) {
    const loopNow = now();
    const symbolState = store.evictStaleSymbolState({ now: loopNow });
    if (symbolState.evictedSymbols.length > 0) {
      contextService.pruneSymbols(symbolState.evictedSymbols);
      if (!isSilent) {
        logger.info("symbol_state_evicted", {
          evictedSymbols: symbolState.evictedSymbols.join(","),
          staleAfterMs: symbolState.staleAfterMs,
          trackedSymbols: symbolState.trackedSymbols.length
        });
      }
    }
    const snapshot = store.getSystemSnapshot();
    const portfolioKillSwitch = store.getPortfolioKillSwitchState({ feeRate: executionFee.feeRate });
    const runningBots = snapshot.botStates.filter((bot: any) => bot.status === "running");
    const latestPricesSummary = snapshot.latestPrices
      .map((entry: any) => `${entry.symbol}:${entry.price.toFixed(2)}`)
      .join(", ");
    const botSummaries = runningBots.map((bot: any) => (
      `${bot.botId}:${bot.activeStrategyId}/${bot.architectSyncStatus}/${bot.lastDecision}`
      + ` eval=${bot.entryEvaluationsCount || 0}`
      + ` logged=${bot.entryEvaluationLogsCount || 0}`
      + ` blocked=${bot.entryBlockedCount || 0}`
      + ` skipped=${bot.entrySkippedCount || 0}`
      + ` opened=${bot.entryOpenedCount || 0}`
    )).join("; ");
    if (!isSilent) {
      logger.info("heartbeat", {
        botsRunning: runningBots.length,
        botSummaries,
        latestPrices: latestPricesSummary,
        openPositions: snapshot.openPositions.length,
        portfolioKillSwitchDrawdownPct: portfolioKillSwitch.drawdownPct,
        portfolioKillSwitchTriggered: portfolioKillSwitch.triggered,
        portfolioKillSwitchReason: portfolioKillSwitch.reason,
        symbolStateLastCleanupAt: symbolState.lastCleanupAt,
        symbolStateStaleCandidates: symbolState.staleCandidateSymbols.length,
        symbolStateTracked: symbolState.trackedSymbols.length,
        pendingBots: runningBots.filter((bot: any) => bot.architectSyncStatus === "pending").length,
        syncedBots: runningBots.filter((bot: any) => bot.architectSyncStatus === "synced").length,
        waitingFlatBots: runningBots.filter((bot: any) => bot.architectSyncStatus === "waiting_flat").length
      });
    }

    if (cli.durationMs && loopNow - startedAt >= cli.durationMs) {
      if (!isSilent) {
        logger.info("duration_reached", { duration: formatDuration(loopNow - startedAt) });
      }
      break;
    }

    if (experimentReporter.isEnabled() && (loopNow - lastExperimentCheckpointAt) >= experimentReporter.getSummaryIntervalMs()) {
      lastExperimentCheckpointAt = loopNow;
      experimentReporter.writeCheckpoint();
      if (!isSilent) {
        experimentReporter.logSummary();
      }
    }

    await sleep(cli.summaryEveryMs);
  }

  await stopGracefully();
}

if (require.main === module) {
  startOrchestrator().catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  parseOptionalBooleanFlag,
  resolveMtfRuntimeConfig,
  startOrchestrator
};
