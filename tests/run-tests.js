"use strict";

const { runBacktestTests } = require("./backtest.test");
const { runActiveStrategiesTests } = require("./activeStrategies.test");
const { runArchitectServiceTests } = require("./architectService.test");
const { runArchitectCoordinatorTests } = require("./architectCoordinator.test");
const { runBotArchitectTests } = require("./botArchitect.test");
const { runBotManagerTests } = require("./botManager.test");
const { runConfigLoaderTests } = require("./configLoader.test");
const { runContextBuilderTests } = require("./contextBuilder.test");
const { runContextServiceTests } = require("./contextService.test");
const { runEntryCoordinatorTests } = require("./entryCoordinator.test");
const { runEntryEconomicsEstimatorTests } = require("./entryEconomicsEstimator.test");
const { runEntryOutcomeCoordinatorTests } = require("./entryOutcomeCoordinator.test");
const { runExitDecisionCoordinatorTests } = require("./exitDecisionCoordinator.test");
const { runExecutionEngineTests } = require("./executionEngine.test");
const { runExperimentReporterTests } = require("./experimentReporter.test");
const { runExitOutcomeCoordinatorTests } = require("./exitOutcomeCoordinator.test");
const { runExitPolicyRegistryTests } = require("./exitPolicyRegistry.test");
const { runExitLifecycleReportTests } = require("./exitLifecycleReport.test");
const { runLoggerTests } = require("./logger.test");
const { runHistoricalBootstrapServiceTests } = require("./historicalBootstrapService.test");
const { runOpenAttemptCoordinatorTests } = require("./openAttemptCoordinator.test");
const { runPerformanceMonitorTests } = require("./performanceMonitor.test");
const { runOrchestratorTests } = require("./orchestrator.test");
const { runPositionLifecycleManagerTests } = require("./positionLifecycleManager.test");
const { runPostLossArchitectLatchTests } = require("./postLossArchitectLatch.test");
const { runPulseUiTests } = require("./pulseUi.test");
const { runRiskManagerTests } = require("./riskManager.test");
const { runRecoveryTargetResolverTests } = require("./recoveryTargetResolver.test");
const { runRegimeDetectorTests } = require("./regimeDetector.test");
const { runSystemServerTests } = require("./systemServer.test");
const { runServerTests } = require("./server.test");
const { runTradeConstraintsTests } = require("./tradeConstraints.test");
const { runRuntimeTests } = require("./runtime.test");
const { runStateStoreTests } = require("./stateStore.test");
const { runStrategyTests } = require("./strategy.test");
const { runStrategySwitcherTests } = require("./strategySwitcher.test");
const { runTradingBotTests } = require("./tradingBot.test");
const { runUserStreamTests } = require("./userStream.test");
const { runWsManagerTests } = require("./wsManager.test");
const { runMarketStreamTests, runMarketStreamLiveEmitIntervalTests } = require("./marketStream.test");
const { runManagedRecoveryExitResolverTests } = require("./managedRecoveryExitResolver.test");
const { runMtfContextAggregatorTests } = require("./mtfContextAggregator.test");
const { runMtfContextServiceTests } = require("./mtfContextService.test");
const { runMtfParamResolverTests } = require("./mtfParamResolver.test");
const { runTradingBotTelemetryTests } = require("./tradingBotTelemetry.test");

async function main() {
  const tests = [
    { name: "activeStrategies", run: async () => runActiveStrategiesTests() },
    { name: "architectService", run: async () => runArchitectServiceTests() },
    { name: "architectCoordinator", run: async () => runArchitectCoordinatorTests() },
    { name: "backtest", run: async () => runBacktestTests() },
    { name: "botArchitect", run: async () => runBotArchitectTests() },
    { name: "botManager", run: async () => runBotManagerTests() },
    { name: "configLoader", run: async () => runConfigLoaderTests() },
    { name: "contextBuilder", run: async () => runContextBuilderTests() },
    { name: "contextService", run: async () => runContextServiceTests() },
    { name: "entryCoordinator", run: async () => runEntryCoordinatorTests() },
    { name: "entryEconomicsEstimator", run: async () => runEntryEconomicsEstimatorTests() },
    { name: "entryOutcomeCoordinator", run: async () => runEntryOutcomeCoordinatorTests() },
    { name: "exitDecisionCoordinator", run: async () => runExitDecisionCoordinatorTests() },
    { name: "executionEngine", run: async () => runExecutionEngineTests() },
    { name: "experimentReporter", run: async () => runExperimentReporterTests() },
    { name: "exitOutcomeCoordinator", run: async () => runExitOutcomeCoordinatorTests() },
    { name: "exitLifecycleReport", run: async () => runExitLifecycleReportTests() },
    { name: "exitPolicyRegistry", run: async () => runExitPolicyRegistryTests() },
    { name: "historicalBootstrapService", run: async () => runHistoricalBootstrapServiceTests() },
    { name: "logger", run: async () => runLoggerTests() },
    { name: "managedRecoveryExitResolver", run: async () => runManagedRecoveryExitResolverTests() },
    { name: "mtfContextAggregator", run: async () => runMtfContextAggregatorTests() },
    { name: "mtfContextService", run: async () => runMtfContextServiceTests() },
    { name: "mtfParamResolver", run: async () => runMtfParamResolverTests() },
    { name: "openAttemptCoordinator", run: async () => runOpenAttemptCoordinatorTests() },
    { name: "performanceMonitor", run: async () => runPerformanceMonitorTests() },
    { name: "orchestrator", run: async () => runOrchestratorTests() },
    { name: "postLossArchitectLatch", run: async () => runPostLossArchitectLatchTests() },
    { name: "positionLifecycleManager", run: async () => runPositionLifecycleManagerTests() },
    { name: "pulseUi", run: async () => runPulseUiTests() },
    { name: "riskManager", run: async () => runRiskManagerTests() },
    { name: "recoveryTargetResolver", run: async () => runRecoveryTargetResolverTests() },
    { name: "regimeDetector", run: async () => runRegimeDetectorTests() },
    { name: "stateStore", run: async () => runStateStoreTests() },
    { name: "strategy", run: async () => runStrategyTests() },
    { name: "strategySwitcher", run: async () => runStrategySwitcherTests() },
    { name: "tradeConstraints", run: async () => runTradeConstraintsTests() },
    { name: "tradingBotTelemetry", run: async () => runTradingBotTelemetryTests() },
    { name: "tradingBot", run: async () => runTradingBotTests() },
    { name: "userStream", run: async () => runUserStreamTests() },
    { name: "wsManager", run: async () => runWsManagerTests() },
    { name: "marketStream", run: async () => runMarketStreamTests() },
    { name: "marketStream.liveEmitInterval", run: async () => runMarketStreamLiveEmitIntervalTests() },
    { name: "systemServer", run: async () => runSystemServerTests() },
    { name: "runtime", run: async () => runRuntimeTests() },
    { name: "server", run: runServerTests }
  ];

  for (const testCase of tests) {
    try {
      await testCase.run();
      console.log(`PASS ${testCase.name}`);
    } catch (error) {
      console.error(`FAIL ${testCase.name}`);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }

  console.log("PASS all");
}

main();
