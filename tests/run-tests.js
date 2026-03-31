"use strict";

const { runBacktestTests } = require("./backtest.test");
const { runServerTests } = require("./server.test");
const { runRuntimeTests } = require("./runtime.test");
const { runStrategyTests } = require("./strategy.test");

async function main() {
  const tests = [
    { name: "backtest", run: async () => runBacktestTests() },
    { name: "strategy", run: async () => runStrategyTests() },
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
