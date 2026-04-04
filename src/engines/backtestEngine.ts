// Module responsibility: optional replay engine placeholder for future historical simulations.
// TODO: keep this explicitly marked as a scaffold until a real replay engine exists.
// Orchestrator currently surfaces its `ok` flag in readiness metadata for visibility only.

class BacktestEngine {
  run() {
    return {
      message: "Backtest engine scaffold ready. Historical replay can be plugged in here.",
      ok: true
    };
  }
}

module.exports = {
  BacktestEngine
};
