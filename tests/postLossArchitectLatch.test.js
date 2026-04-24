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
  const switchedStrategyLatchState = latch.getState("emaCross", activeState);
  if (!switchedStrategyLatchState.blocking || switchedStrategyLatchState.strategyId !== "rsiReversion") {
    throw new Error(`active post-loss latch should block globally after a strategy switch while preserving strategy metadata: ${JSON.stringify(switchedStrategyLatchState)}`);
  }
  store.updateBotState("bot_test", {
    postLossArchitectLatchTimedOutAt: 12_000
  });
  const timedOutSwitchedStrategyLatchState = latch.getState("emaCross", store.getBotState("bot_test"));
  if (!timedOutSwitchedStrategyLatchState.blocking || timedOutSwitchedStrategyLatchState.timedOutAt !== 12_000) {
    throw new Error(`timed-out post-loss latch should still block globally after a strategy switch: ${JSON.stringify(timedOutSwitchedStrategyLatchState)}`);
  }
  store.updateBotState("bot_test", {
    postLossArchitectLatchTimedOutAt: null
  });

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

  const singlePublishStore = new StateStore();
  singlePublishStore.registerBot(botConfig);
  singlePublishStore.setArchitectPublisherState("BTC/USDT", {
    challengerCount: 0,
    challengerRegime: null,
    challengerRequired: 2,
    hysteresisActive: false,
    lastObservedAt: 2_000,
    lastPublishedAt: 2_000,
    lastPublishedRegime: "range",
    nextPublishAt: 17_000,
    publishIntervalMs: 15_000,
    ready: true,
    symbol: "BTC/USDT",
    warmupStartedAt: 0
  });
  const singlePublishLatch = new PostLossArchitectLatch({
    botId: "bot_test",
    requiredPublishes: 1,
    store: singlePublishStore,
    symbol: "BTC/USDT"
  });
  singlePublishLatch.activateOnLoss({
    closedAt: 12_000,
    netPnl: -0.5,
    strategyId: "rsiReversion"
  });
  singlePublishStore.setArchitectPublisherState("BTC/USDT", {
    ...singlePublishStore.getArchitectPublisherState("BTC/USDT"),
    lastPublishedAt: 18_000,
    ready: true
  });
  const singlePublishRefresh = singlePublishLatch.refresh();
  if (!singlePublishRefresh.transition || singlePublishRefresh.transition.message !== "post_loss_architect_latch_released") {
    throw new Error(`a single required fresh publish should release the latch immediately when configured: ${JSON.stringify(singlePublishRefresh)}`);
  }
  if (singlePublishStore.getBotState("bot_test").postLossArchitectLatchFreshPublishCount !== 1 || singlePublishStore.getBotState("bot_test").postLossArchitectLatchActive) {
    throw new Error(`single fresh publication configuration should release the latch after the first fresh publish: ${JSON.stringify(singlePublishStore.getBotState("bot_test"))}`);
  }
}

module.exports = {
  runPostLossArchitectLatchTests
};
