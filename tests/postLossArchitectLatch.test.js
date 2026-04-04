"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { PostLossArchitectLatch } = require("../src/roles/postLossArchitectLatch.ts");

function runPostLossArchitectLatchTests() {
  const store = new StateStore();
  const botConfig = {
    enabled: true,
    id: "bot_test",
    riskProfile: "medium",
    strategy: "rsiReversion",
    symbol: "BTC/USDT"
  };
  store.registerBot(botConfig);
  store.setArchitectPublisherState("BTC/USDT", {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: 1_000,
    lastPublishedAt: 1_000,
    lastPublishedRegime: "range",
    nextPublishAt: 31_000,
    publishIntervalMs: 30_000,
    ready: true,
    symbol: "BTC/USDT",
    warmupStartedAt: 0
  });

  const latch = new PostLossArchitectLatch({
    botId: "bot_test",
    requiredPublishes: 2,
    store,
    symbol: "BTC/USDT"
  });

  const noActivation = latch.activateOnLoss({
    closedAt: 5_000,
    netPnl: 0,
    strategyId: "rsiReversion"
  });
  if (noActivation.transition) {
    throw new Error("post-loss latch should not activate on a non-loss close");
  }

  const activation = latch.activateOnLoss({
    closedAt: 10_000,
    netPnl: -1.23456,
    strategyId: "rsiReversion"
  });
  if (!activation.transition || activation.transition.message !== "post_loss_architect_latch_activated") {
    throw new Error(`expected activation transition, received ${JSON.stringify(activation)}`);
  }
  const activeState = store.getBotState("bot_test");
  if (!activeState.postLossArchitectLatchActive || activeState.postLossArchitectLatchFreshPublishCount !== 0) {
    throw new Error(`loss close should activate latch state: ${JSON.stringify(activeState)}`);
  }

  let refreshed = latch.refresh();
  if (refreshed.transition) {
    throw new Error("stale publisher timestamps should not count toward the latch");
  }

  store.setArchitectPublisherState("BTC/USDT", {
    ...store.getArchitectPublisherState("BTC/USDT"),
    lastPublishedAt: 15_000,
    ready: true
  });
  refreshed = latch.refresh();
  if (!refreshed.transition || refreshed.transition.message !== "post_loss_architect_latch_publish_counted") {
    throw new Error(`first fresh publish should increment latch count: ${JSON.stringify(refreshed)}`);
  }
  if (store.getBotState("bot_test").postLossArchitectLatchFreshPublishCount !== 1) {
    throw new Error("first fresh publish should increment latch count to one");
  }

  refreshed = latch.refresh();
  if (refreshed.transition) {
    throw new Error("reused publisher state should not be counted twice");
  }

  store.setArchitectPublisherState("BTC/USDT", {
    ...store.getArchitectPublisherState("BTC/USDT"),
    lastPublishedAt: 25_000,
    ready: true
  });
  refreshed = latch.refresh();
  if (!refreshed.transition || refreshed.transition.message !== "post_loss_architect_latch_released") {
    throw new Error(`second fresh publish should release the latch: ${JSON.stringify(refreshed)}`);
  }
  const releasedState = store.getBotState("bot_test");
  if (releasedState.postLossArchitectLatchActive || releasedState.postLossArchitectLatchFreshPublishCount !== 2) {
    throw new Error(`latch should be released after the second fresh publish: ${JSON.stringify(releasedState)}`);
  }

  const latchState = latch.getState("rsiReversion", releasedState);
  if (latchState.blocking) {
    throw new Error("released latch should no longer block entries");
  }
}

module.exports = {
  runPostLossArchitectLatchTests
};
