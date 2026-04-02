"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { UserStream } = require("../src/streams/userStream.ts");

async function runUserStreamTests() {
  const store = new StateStore();
  store.registerBot({
    allowedStrategies: ["emaCross"],
    enabled: true,
    id: "bot_a",
    initialBalanceUsdt: 1000,
    riskProfile: "medium",
    strategy: "emaCross",
    symbol: "BTC/USDT"
  });

  const published = [];
  const logs = [];
  const userStream = new UserStream({
    logger: {
      info(event, metadata) {
        logs.push({ event, metadata });
      },
      warn() {},
      error() {}
    },
    store,
    wsManager: {
      publish(channel, payload) {
        published.push({ channel, payload });
      },
      subscribe() {
        return () => {};
      }
    }
  });

  await userStream.start({
    enabled: false,
    mode: "mock",
    reason: "paper_execution"
  });

  const wsConnection = store.getWsConnections().find((item) => item.connectionId === "user-stream");
  if (!wsConnection || wsConnection.status !== "disabled" || wsConnection.lastReason !== "paper_execution") {
    throw new Error("user stream did not stay safely disabled in paper mode");
  }
  const disabledLog = logs.find((entry) => entry.event === "user_stream_disabled");
  if (!disabledLog || disabledLog.metadata.reason !== "paper_execution") {
    throw new Error("user stream did not log paper-mode disable reason");
  }

  userStream.publishOrderUpdate({
    order: {
      botId: "bot_a",
      id: "order-1",
      price: 68000,
      quantity: 0.01,
      reason: ["paper_entry"],
      side: "buy",
      strategyId: "emaCross",
      symbol: "BTC/USDT",
      timestamp: 1000
    },
    position: {
      botId: "bot_a",
      confidence: 0.7,
      entryPrice: 68000,
      id: "order-1",
      notes: ["paper_entry"],
      openedAt: 1000,
      quantity: 0.01,
      strategyId: "emaCross",
      symbol: "BTC/USDT"
    },
    type: "opened"
  });

  if (!store.getPosition("bot_a")) {
    throw new Error("paper user stream did not preserve simulated position updates");
  }
  if (!published.find((entry) => entry.channel === "user:orders")) {
    throw new Error("paper user stream did not emit normalized order events");
  }
}

module.exports = {
  runUserStreamTests
};
