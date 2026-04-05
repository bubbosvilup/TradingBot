"use strict";

const { RegimeDetector } = require("../src/roles/regimeDetector.ts");

function runRegimeDetectorTests() {
  const detector = new RegimeDetector();

  if (detector.detect([100, 101, 102]) !== "warming") {
    throw new Error("regime detector should keep short histories in warming mode");
  }

  const trendSeries = Array.from({ length: 20 }, (_, index) => 100 + (index * 0.2));
  if (detector.detect(trendSeries) !== "trend") {
    throw new Error(`trend classification regressed: ${detector.detect(trendSeries)}`);
  }

  const bearSeries = Array.from({ length: 20 }, (_, index) => 100 - (index * 0.2));
  if (detector.detect(bearSeries) !== "bear") {
    throw new Error(`bear classification regressed: ${detector.detect(bearSeries)}`);
  }

  const breakoutSeries = [
    100, 103.6, 98.8, 104.1, 99.5,
    102.7, 99.1, 103.4, 98.9, 104.2,
    99.4, 102.9, 99.2, 103.8, 98.7,
    104.4, 99.3, 103.1, 99.8, 100.2
  ];
  if (detector.detect(breakoutSeries) !== "breakout") {
    throw new Error(`breakout classification regressed: ${detector.detect(breakoutSeries)}`);
  }

  const rangeSeries = [
    100, 100.2, 100.1, 100.3, 100.2,
    100.1, 100.3, 100.2, 100.1, 100.2,
    100.3, 100.2, 100.1, 100.2, 100.3,
    100.2, 100.1, 100.2, 100.3, 100.2
  ];
  if (detector.detect(rangeSeries) !== "range") {
    throw new Error(`range classification regressed: ${detector.detect(rangeSeries)}`);
  }
}

module.exports = {
  runRegimeDetectorTests
};
