"use strict";

const { runBacktestTests } = require("./backtest.test");
const { runActiveStrategiesTests } = require("./activeStrategies.test");
const { runArchitectServiceTests } = require("./architectService.test");
const { runBotArchitectTests } = require("./botArchitect.test");
const { runContextServiceTests } = require("./contextService.test");
const { runExecutionEngineTests } = require("./executionEngine.test");
const { runLoggerTests } = require("./logger.test");
const { runOrchestratorTests } = require("./orchestrator.test");
const { runRiskManagerTests } = require("./riskManager.test");
const { runSystemServerTests } = require("./systemServer.test");
const { runServerTests } = require("./server.test");
const { runRuntimeTests } = require("./runtime.test");
const { runStrategyTests } = require("./strategy.test");
const { runStrategySwitcherTests } = require("./strategySwitcher.test");
const { runTradingBotTests } = require("./tradingBot.test");
const { runUserStreamTests } = require("./userStream.test");
const { runWsManagerTests } = require("./wsManager.test");
const { runMarketStreamTests } = require("./marketStream.test");

async function main() {
  const tests = [
    { name: "activeStrategies", run: async () => runActiveStrategiesTests() },
    { name: "architectService", run: async () => runArchitectServiceTests() },
    { name: "backtest", run: async () => runBacktestTests() },
    { name: "botArchitect", run: async () => runBotArchitectTests() },
    { name: "contextService", run: async () => runContextServiceTests() },
    { name: "executionEngine", run: async () => runExecutionEngineTests() },
    { name: "logger", run: async () => runLoggerTests() },
    { name: "orchestrator", run: async () => runOrchestratorTests() },
    { name: "riskManager", run: async () => runRiskManagerTests() },
    { name: "strategy", run: async () => runStrategyTests() },
    { name: "strategySwitcher", run: async () => runStrategySwitcherTests() },
    { name: "tradingBot", run: async () => runTradingBotTests() },
    { name: "userStream", run: async () => runUserStreamTests() },
    { name: "wsManager", run: async () => runWsManagerTests() },
    { name: "marketStream", run: async () => runMarketStreamTests() },
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
