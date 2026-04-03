"use strict";

const { ConfigLoader } = require("../src/core/configLoader.ts");
const { StrategyRegistry } = require("../src/core/strategyRegistry.ts");
const { StrategySwitcher } = require("../src/roles/strategySwitcher.ts");

function createArchitect(overrides = {}) {
  return {
    absoluteConviction: 0.09,
    confidence: 0.1,
    contextMaturity: 0.8,
    dataMode: "live",
    decisionStrength: 0.01,
    familyScores: {
      mean_reversion: 0.18,
      no_trade: 0.1,
      trend_following: 0.22
    },
    featureConflict: 0.12,
    marketRegime: "trend",
    reasonCodes: ["trend_structure"],
    recommendedFamily: "trend_following",
    regimeScores: {
      range: 0.18,
      trend: 0.22,
      unclear: 0.08,
      volatile: 0.1
    },
    sampleSize: 120,
    signalAgreement: 0.21,
    structureState: "trending",
    sufficientData: true,
    summary: "Published architect decision.",
    symbol: "BTC/USDT",
    trendBias: "bullish",
    updatedAt: Date.now(),
    volatilityState: "normal",
    ...overrides
  };
}

function runStrategySwitcherTests() {
  const strategyRegistry = new StrategyRegistry({
    configLoader: new ConfigLoader(),
    indicatorEngine: {}
  });
  strategyRegistry.load();
  const switcher = new StrategySwitcher({
    resolveStrategyFamily(strategyId) {
      return strategyRegistry.getStrategyFamily(strategyId);
    }
  });
  const baseState = {
    activeStrategyId: "rsiReversion"
  };

  if (switcher.getStrategyFamily("emaCross") !== "trend_following") {
    throw new Error("emaCross family should resolve from configured registry metadata");
  }
  if (switcher.getStrategyFamily("rsiReversion") !== "mean_reversion") {
    throw new Error("rsiReversion family should resolve from configured registry metadata");
  }
  if (switcher.getStrategyFamily("breakout") !== "trend_following") {
    throw new Error("breakout family should resolve from configured registry metadata");
  }

  const nonRoutable = switcher.getNonRoutableStrategies(["breakout", "emaCross", "unknownStrategy"]);
  if (nonRoutable.length !== 1 || nonRoutable[0] !== "unknownStrategy") {
    throw new Error(`non-routable strategy detection returned an unexpected result: ${nonRoutable.join(",")}`);
  }

  const switched = switcher.evaluate({
    architect: createArchitect(),
    availableStrategies: ["emaCross", "rsiReversion"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: false,
    state: baseState
  });
  if (!switched || switched.nextStrategyId !== "emaCross") {
    throw new Error("published architect decision was still vetoed by local score thresholds");
  }

  const blockedByPosition = switcher.evaluate({
    architect: createArchitect(),
    availableStrategies: ["emaCross", "rsiReversion"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: true,
    state: baseState
  });
  if (blockedByPosition !== null) {
    throw new Error("flat guard did not block switching while position is open");
  }

  const blockedNoTrade = switcher.evaluate({
    architect: createArchitect({
      marketRegime: "volatile",
      recommendedFamily: "no_trade"
    }),
    availableStrategies: ["emaCross", "rsiReversion"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: false,
    state: baseState
  });
  if (blockedNoTrade !== null) {
    throw new Error("no_trade architect family should prevent switching");
  }

  const blockedSameFamily = switcher.evaluate({
    architect: createArchitect({
      marketRegime: "range",
      recommendedFamily: "mean_reversion"
    }),
    availableStrategies: ["emaCross", "rsiReversion"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: false,
    state: {
      activeStrategyId: "rsiReversion"
    }
  });
  if (blockedSameFamily !== null) {
    throw new Error("same-family architect decision should not trigger switching");
  }

  const breakoutRoute = switcher.evaluate({
    architect: createArchitect(),
    availableStrategies: ["breakout", "rsiReversion"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: false,
    state: baseState
  });
  if (!breakoutRoute || breakoutRoute.nextStrategyId !== "breakout") {
    throw new Error("configured breakout strategy should be routable for trend_following family");
  }

  const blockedUnsupportedFamilyTarget = switcher.evaluate({
    architect: createArchitect({
      marketRegime: "range",
      recommendedFamily: "mean_reversion"
    }),
    availableStrategies: ["breakout", "emaCross"],
    botConfig: {
      id: "bot_a",
      symbol: "BTC/USDT"
    },
    now: Date.now(),
    positionOpen: false,
    state: {
      activeStrategyId: "emaCross"
    }
  });
  if (blockedUnsupportedFamilyTarget !== null) {
    throw new Error("trend-only strategy set should not satisfy a mean_reversion target");
  }

  let invalidFamilyError = null;
  try {
    const invalidRegistry = new StrategyRegistry({
      configLoader: {
        loadStrategiesConfig() {
          return {
            strategies: [
              {
                config: "./strategies/emaCross/config.json",
                family: "invalid_family",
                id: "brokenStrategy",
                module: "./strategies/emaCross/strategy.ts"
              }
            ]
          };
        }
      },
      indicatorEngine: {}
    });
    invalidRegistry.load();
  } catch (error) {
    invalidFamilyError = error;
  }
  if (!invalidFamilyError || !String(invalidFamilyError.message || invalidFamilyError).includes("invalid or missing family metadata")) {
    throw new Error("invalid strategy family metadata should fail clearly during registry load");
  }
}

module.exports = {
  runStrategySwitcherTests
};
