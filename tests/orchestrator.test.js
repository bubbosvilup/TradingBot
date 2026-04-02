"use strict";

async function runOrchestratorTests() {
  const { parseArgs, startOrchestrator } = require("../src/core/orchestrator.ts");

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

  try {
    await startOrchestrator({ durationMs: 2200, serverEnabled: false, summaryEveryMs: 1000 });
  } finally {
    console.log = originalLog;
  }

  const transcript = captured.join("\n");
  if (!transcript.includes("system_ready")) {
    throw new Error(`orchestrator did not reach ready state\n${transcript}`);
  }
  if (!transcript.includes("executionMode=paper")) {
    throw new Error(`orchestrator did not log execution mode clearly\n${transcript}`);
  }
  if (!transcript.includes("executionSafety=simulated_only")) {
    throw new Error(`orchestrator did not log simulated execution safety\n${transcript}`);
  }
  if (!transcript.includes("heartbeat")) {
    throw new Error(`orchestrator did not emit heartbeat\n${transcript}`);
  }
  if (!transcript.includes("system_stopped")) {
    throw new Error(`orchestrator did not stop cleanly\n${transcript}`);
  }
}

module.exports = {
  runOrchestratorTests
};
