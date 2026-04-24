function startTimer() {
  return process.hrtime.bigint();
}

function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

module.exports = {
  elapsedMs,
  startTimer
};
