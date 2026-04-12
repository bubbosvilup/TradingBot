// Compatibility bootstrap: keep `node bot.js` working while the real runtime lives in src/core/orchestrator.ts.

const path = require("node:path");
const { spawn } = require("node:child_process");

const orchestratorPath = path.join(__dirname, "src", "core", "orchestrator.ts");
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--experimental-strip-types", orchestratorPath, ...process.argv.slice(2)], {
  stdio: "inherit"
});

let shuttingDown = false;

// Forward signals to child process and WAIT for it to exit
const forwardSignal = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Send SIGINT to child - the child will handle graceful shutdown and write the report
  child.kill(signal);
  // Do NOT exit here - wait for child.on("exit") to fire
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  // Child has finished its shutdown (including report writing)
  process.exit(code ?? 0);
});
