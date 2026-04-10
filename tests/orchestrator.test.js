"use strict";

async function runOrchestratorTests() {
  const { FakeWebSocket } = require("./fakeWebSocket");
  const originalWebSocket = global.WebSocket;
  global.WebSocket = FakeWebSocket;
  const { parseArgs, startOrchestrator } = require("../src/core/orchestrator.ts");
  const { UserStream } = require("../src/streams/userStream.ts");
  const originalMarketMode = process.env.MARKET_MODE;
  const originalExecutionMode = process.env.EXECUTION_MODE;
  const originalFeeBps = process.env.FEE_BPS;
  const originalLogType = process.env.LOG_TYPE;
  const originalPaperTrading = process.env.PAPER_TRADING;
  const originalUserStreamStart = UserStream.prototype.start;
  let userStreamStartCalls = 0;
  UserStream.prototype.start = async function startSpy(...args) {
    userStreamStartCalls += 1;
    return originalUserStreamStart.apply(this, args);
  };

  const kebabArgs = parseArgs(["--market-mode=live", "--execution-mode=paper", "--duration-ms=2200", "--summary-ms=1000"]);
  if (kebabArgs.marketMode !== "live" || kebabArgs.executionMode !== "paper") {
    throw new Error("kebab-case CLI args are not parsed correctly");
  }
  if (kebabArgs.durationMs !== 2200 || kebabArgs.summaryEveryMs !== 1000) {
    throw new Error("duration/summary CLI args are not parsed correctly");
  }

  const camelArgs = parseArgs(["--marketMode", "live", "--executionMode", "paper", "--durationMs", "2300", "--summaryMs", "1100"]);
  if (camelArgs.marketMode !== "live" || camelArgs.executionMode !== "paper") {
    throw new Error("camelCase CLI args are not parsed correctly");
  }
  if (camelArgs.durationMs !== 2300 || camelArgs.summaryEveryMs !== 1100) {
    throw new Error("camelCase duration/summary CLI args are not parsed correctly");
  }

  const captured = [];
  const originalLog = console.log;
  console.log = (...args) => {
    captured.push(args.join(" "));
  };
  process.env.FEE_BPS = "17";
  process.env.LOG_TYPE = "verbose";

  try {
    await startOrchestrator({ durationMs: 2200, serverEnabled: false, summaryEveryMs: 1000 });
  } finally {
    console.log = originalLog;
    if (originalFeeBps === undefined) {
      delete process.env.FEE_BPS;
    } else {
      process.env.FEE_BPS = originalFeeBps;
    }
    if (originalLogType === undefined) {
      delete process.env.LOG_TYPE;
    } else {
      process.env.LOG_TYPE = originalLogType;
    }
  }

  const transcript = captured.join("\n");
  if (!transcript.includes("system_ready")) {
    throw new Error(`orchestrator did not reach ready state\n${transcript}`);
  }
  if (transcript.includes("backtestEngine=")) {
    throw new Error(`orchestrator should not expose scaffold backtest readiness in system_ready\n${transcript}`);
  }
  if (!transcript.includes("executionMode=paper")) {
    throw new Error(`orchestrator did not log execution mode clearly\n${transcript}`);
  }
  if (!transcript.includes("marketMode=live")) {
    throw new Error(`orchestrator did not log live-only market mode clearly\n${transcript}`);
  }
  if (!transcript.includes("executionSafety=simulated_only")) {
    throw new Error(`orchestrator did not log simulated execution safety\n${transcript}`);
  }
  if (!transcript.includes("feeRate=0.0017") || !transcript.includes("feeRateSource=FEE_BPS")) {
    throw new Error(`orchestrator did not log resolved fee configuration\n${transcript}`);
  }
  if (!transcript.includes("heartbeat")) {
    throw new Error(`orchestrator did not emit heartbeat\n${transcript}`);
  }
  if (!transcript.includes("botSummaries=") || !transcript.includes("latestPrices=")) {
    throw new Error(`orchestrator heartbeat did not include summary-oriented bot state\n${transcript}`);
  }
  if (!transcript.includes("system_stopped")) {
    throw new Error(`orchestrator did not stop cleanly\n${transcript}`);
  }
  if ((transcript.match(/system_stopped/g) || []).length !== 1) {
    throw new Error(`orchestrator shutdown should be idempotent and log system_stopped once\n${transcript}`);
  }
  if (userStreamStartCalls !== 0) {
    throw new Error(`paper-only orchestrator should not start the live user stream path; observed ${userStreamStartCalls} start calls`);
  }
  if (!transcript.includes("userStreamRuntime=paper_simulated_events_only")) {
    throw new Error(`orchestrator did not surface paper-only user stream segregation clearly\n${transcript}`);
  }
  if (!transcript.includes("portfolioKillSwitchEnabled=true")
    || !transcript.includes("portfolioKillSwitchMode=block_entries_only")
    || !transcript.includes("portfolioKillSwitchMaxDrawdownPct=8")) {
    throw new Error(`orchestrator did not log portfolio kill switch readiness clearly\n${transcript}`);
  }
  if (!transcript.includes("architectWarmupMs=20000")
    || !transcript.includes("architectPublishIntervalMs=15000")
    || !transcript.includes("postLossLatchMinFreshPublications=1")) {
    throw new Error(`orchestrator did not log architect/latch runtime tuning clearly\n${transcript}`);
  }
  if (!transcript.includes("symbolStateRetentionMs=1800000")
    || !transcript.includes("symbolStateTracked=")
    || !transcript.includes("symbolStateStaleCandidates=")) {
    throw new Error(`orchestrator did not log symbol-state retention diagnostics clearly\n${transcript}`);
  }

  process.env.MARKET_MODE = "mock";
  try {
    await startOrchestrator({ durationMs: 2200, serverEnabled: false, summaryEveryMs: 1000 });
    throw new Error("orchestrator should fail fast when market-mode=mock is requested");
  } catch (error) {
    if (!String(error && error.message).includes("market-mode=mock is not supported")) {
      throw new Error(`orchestrator did not fail with a clear mock-market error\n${error && error.stack ? error.stack : error}`);
    }
  } finally {
    if (originalMarketMode === undefined) {
      delete process.env.MARKET_MODE;
    } else {
      process.env.MARKET_MODE = originalMarketMode;
    }
  }

  process.env.EXECUTION_MODE = "live";
  try {
    await startOrchestrator({ durationMs: 2200, serverEnabled: false, summaryEveryMs: 1000 });
    throw new Error("orchestrator should fail fast when execution-mode=live is requested");
  } catch (error) {
    if (!String(error && error.message).includes("execution-mode=live is not supported")) {
      throw new Error(`orchestrator did not fail with a clear live-mode error\n${error && error.stack ? error.stack : error}`);
    }
  } finally {
    if (originalExecutionMode === undefined) {
      delete process.env.EXECUTION_MODE;
    } else {
      process.env.EXECUTION_MODE = originalExecutionMode;
    }
  }

  process.env.PAPER_TRADING = "false";
  try {
    await startOrchestrator({ durationMs: 2200, serverEnabled: false, summaryEveryMs: 1000 });
    throw new Error("orchestrator should fail fast when legacy PAPER_TRADING=false implies non-paper execution");
  } catch (error) {
    if (!String(error && error.message).includes("PAPER_TRADING=false is not supported")) {
      throw new Error(`orchestrator did not fail with a clear legacy paper-trading error\n${error && error.stack ? error.stack : error}`);
    }
  } finally {
    if (originalPaperTrading === undefined) {
      delete process.env.PAPER_TRADING;
    } else {
      process.env.PAPER_TRADING = originalPaperTrading;
    }
    UserStream.prototype.start = originalUserStreamStart;
    global.WebSocket = originalWebSocket;
  }
}

module.exports = {
  runOrchestratorTests
};
