export interface Clock {
  now(): number;
}

const systemClock: Clock = {
  now(): number {
    return Date.now();
  }
};

function resolveClock(clock?: Clock | null): Clock {
  return clock && typeof clock.now === "function" ? clock : systemClock;
}

module.exports = {
  resolveClock,
  systemClock
};
