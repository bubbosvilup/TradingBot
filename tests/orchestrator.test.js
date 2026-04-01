"use strict";

async function runOrchestratorTests() {
  const { startOrchestrator } = require("../src/core/orchestrator.ts");

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
