"use strict";

const { runBacktestTests } = require("./backtest.test");
const { runOrchestratorTests } = require("./orchestrator.test");
const { runSystemServerTests } = require("./systemServer.test");
const { runServerTests } = require("./server.test");
const { runRuntimeTests } = require("./runtime.test");
const { runStrategyTests } = require("./strategy.test");
const { runTradingBotTests } = require("./tradingBot.test");
const { runWsManagerTests } = require("./wsManager.test");
const { runMarketStreamTests } = require("./marketStream.test");

async function main() {
  const tests = [
    { name: "backtest", run: async () => runBacktestTests() },
    { name: "orchestrator", run: async () => runOrchestratorTests() },
    { name: "strategy", run: async () => runStrategyTests() },
    { name: "tradingBot", run: async () => runTradingBotTests() },
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
