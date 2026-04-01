// Compatibility bootstrap: keep `node bot.js` working while the real runtime lives in src/core/orchestrator.ts.

const path = require("node:path");
const { spawn } = require("node:child_process");

const orchestratorPath = path.join(__dirname, "src", "core", "orchestrator.ts");
const child = spawn(process.execPath, ["--experimental-strip-types", orchestratorPath, ...process.argv.slice(2)], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
