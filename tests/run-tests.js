"use strict";

const { runBacktestTests } = require("./backtest.test");
const { runActiveStrategiesTests } = require("./activeStrategies.test");
const { runArchitectServiceTests } = require("./architectService.test");
const { runArchitectCoordinatorTests } = require("./architectCoordinator.test");
const { runBotArchitectTests } = require("./botArchitect.test");
const { runConfigLoaderTests } = require("./configLoader.test");
const { runContextBuilderTests } = require("./contextBuilder.test");
const { runContextServiceTests } = require("./contextService.test");
const { runEntryCoordinatorTests } = require("./entryCoordinator.test");
const { runEntryOutcomeCoordinatorTests } = require("./entryOutcomeCoordinator.test");
const { runExitDecisionCoordinatorTests } = require("./exitDecisionCoordinator.test");
const { runExecutionEngineTests } = require("./executionEngine.test");
const { runExitOutcomeCoordinatorTests } = require("./exitOutcomeCoordinator.test");
const { runExitPolicyRegistryTests } = require("./exitPolicyRegistry.test");
const { runExitLifecycleReportTests } = require("./exitLifecycleReport.test");
const { runLoggerTests } = require("./logger.test");
const { runOpenAttemptCoordinatorTests } = require("./openAttemptCoordinator.test");
const { runOrchestratorTests } = require("./orchestrator.test");
const { runPostLossArchitectLatchTests } = require("./postLossArchitectLatch.test");
const { runPositionLifecycleManagerTests } = require("./positionLifecycleManager.test");
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
const { runTradingBotTelemetryTests } = require("./tradingBotTelemetry.test");

async function main() {
  const tests = [
    { name: "activeStrategies", run: async () => runActiveStrategiesTests() },
    { name: "architectService", run: async () => runArchitectServiceTests() },
    { name: "architectCoordinator", run: async () => runArchitectCoordinatorTests() },
    { name: "backtest", run: async () => runBacktestTests() },
    { name: "botArchitect", run: async () => runBotArchitectTests() },
    { name: "configLoader", run: async () => runConfigLoaderTests() },
    { name: "contextBuilder", run: async () => runContextBuilderTests() },
    { name: "contextService", run: async () => runContextServiceTests() },
    { name: "entryCoordinator", run: async () => runEntryCoordinatorTests() },
    { name: "entryOutcomeCoordinator", run: async () => runEntryOutcomeCoordinatorTests() },
    { name: "exitDecisionCoordinator", run: async () => runExitDecisionCoordinatorTests() },
    { name: "executionEngine", run: async () => runExecutionEngineTests() },
    { name: "exitOutcomeCoordinator", run: async () => runExitOutcomeCoordinatorTests() },
    { name: "exitLifecycleReport", run: async () => runExitLifecycleReportTests() },
    { name: "exitPolicyRegistry", run: async () => runExitPolicyRegistryTests() },
    { name: "logger", run: async () => runLoggerTests() },
    { name: "managedRecoveryExitResolver", run: async () => runManagedRecoveryExitResolverTests() },
    { name: "openAttemptCoordinator", run: async () => runOpenAttemptCoordinatorTests() },
    { name: "orchestrator", run: async () => runOrchestratorTests() },
    { name: "postLossArchitectLatch", run: async () => runPostLossArchitectLatchTests() },
    { name: "positionLifecycleManager", run: async () => runPositionLifecycleManagerTests() },
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
