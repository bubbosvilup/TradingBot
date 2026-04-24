"use strict";

const { StateStore } = require("../src/core/stateStore.ts");
const { UserStream } = require("../src/streams/userStream.ts");

function rejectAfter(ms, message) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

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
  const originalFetch = global.fetch;
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
    mode: "live",
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

  try {
    global.fetch = async () => ({
      ok: false,
      status: 401
    });
    const liveStore = new StateStore();
    const degradedLogs = [];
    const liveUserStream = new UserStream({
      apiKey: "test-key",
      logger: {
        info() {},
        warn(event, metadata) {
          degradedLogs.push({ event, metadata });
        },
        error() {}
      },
      store: liveStore,
      wsManager: {
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    });
    await liveUserStream.keepAliveListenKey("listen-key-test");
    const degradedConnection = liveStore.getWsConnections().find((item) => item.connectionId === "user-stream");
    if (!degradedConnection || degradedConnection.status !== "degraded" || degradedConnection.lastReason !== "keepalive_401") {
      throw new Error(`user stream should mark keepalive failures explicitly for operator attention: ${JSON.stringify(degradedConnection)}`);
    }
    const keepAliveFailureLog = degradedLogs.find((entry) => entry.event === "user_stream_keepalive_failed");
    if (!keepAliveFailureLog || keepAliveFailureLog.metadata.action !== "manual_attention_needed" || keepAliveFailureLog.metadata.status !== 401) {
      throw new Error(`user stream should log explicit keepalive degradation context: ${JSON.stringify(degradedLogs)}`);
    }
  } finally {
    global.fetch = originalFetch;
  }

  try {
    const timeoutStore = new StateStore();
    const timeoutLogs = [];
    let keepAliveAbortObserved = false;
    global.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        keepAliveAbortObserved = true;
        reject(options.signal.reason || new Error("aborted"));
      });
    });
    const timeoutUserStream = new UserStream({
      apiKey: "test-key",
      logger: {
        info() {},
        warn(event, metadata) {
          timeoutLogs.push({ event, metadata });
        },
        error() {}
      },
      requestTimeoutMs: 5,
      store: timeoutStore,
      wsManager: {
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    });
    const unhandledRejections = [];
    const onUnhandledRejection = (reason) => {
      unhandledRejections.push(reason);
    };
    process.once("unhandledRejection", onUnhandledRejection);
    await Promise.race([
      timeoutUserStream.keepAliveListenKey("listen-key-timeout"),
      rejectAfter(100, "keepalive timeout test hung")
    ]);
    process.removeListener("unhandledRejection", onUnhandledRejection);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timedOutConnection = timeoutStore.getWsConnections().find((item) => item.connectionId === "user-stream");
    if (!keepAliveAbortObserved || !timedOutConnection || timedOutConnection.status !== "degraded" || timedOutConnection.lastReason !== "keepalive_timeout") {
      throw new Error(`keepalive timeout should abort fetch and mark degraded: ${JSON.stringify({ keepAliveAbortObserved, timedOutConnection })}`);
    }
    const timeoutLog = timeoutLogs.find((entry) => entry.event === "user_stream_keepalive_failed");
    if (!timeoutLog || timeoutLog.metadata.operation !== "keepalive_listen_key" || timeoutLog.metadata.reason !== "timeout") {
      throw new Error(`keepalive timeout should log operation and timeout reason: ${JSON.stringify(timeoutLogs)}`);
    }
    if (unhandledRejections.length > 0) {
      throw new Error(`keepalive timeout should not emit unhandled rejections: ${String(unhandledRejections[0])}`);
    }
  } finally {
    global.fetch = originalFetch;
  }

  try {
    const createTimeoutStore = new StateStore();
    const createTimeoutLogs = [];
    let createAbortObserved = false;
    global.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        createAbortObserved = true;
        reject(options.signal.reason || new Error("aborted"));
      });
    });
    const createTimeoutUserStream = new UserStream({
      apiKey: "test-key",
      logger: {
        info() {},
        warn(event, metadata) {
          createTimeoutLogs.push({ event, metadata });
        },
        error() {}
      },
      requestTimeoutMs: 5,
      store: createTimeoutStore,
      wsManager: {
        connectBinanceUserStream() {
          throw new Error("should not connect without listen key");
        },
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    });
    await Promise.race([
      createTimeoutUserStream.start({ mode: "live" }),
      rejectAfter(100, "listen-key timeout test hung")
    ]);
    const createTimeoutConnection = createTimeoutStore.getWsConnections().find((item) => item.connectionId === "user-stream");
    if (!createAbortObserved || !createTimeoutConnection || createTimeoutConnection.status !== "disconnected" || createTimeoutConnection.lastReason !== "listen_key_timeout") {
      throw new Error(`listen-key timeout should abort fetch and mark disconnected: ${JSON.stringify({ createAbortObserved, createTimeoutConnection })}`);
    }
    const listenKeyTimeoutLog = createTimeoutLogs.find((entry) => entry.event === "user_stream_listen_key_failed");
    if (!listenKeyTimeoutLog || listenKeyTimeoutLog.metadata.operation !== "create_listen_key" || listenKeyTimeoutLog.metadata.reason !== "timeout") {
      throw new Error(`listen-key timeout should log operation and timeout reason: ${JSON.stringify(createTimeoutLogs)}`);
    }
  } finally {
    global.fetch = originalFetch;
  }

  try {
    const successStore = new StateStore();
    const successLogs = [];
    let keepAliveSignalProvided = false;
    global.fetch = async (_url, options = {}) => {
      keepAliveSignalProvided = Boolean(options.signal);
      return {
        ok: true,
        status: 200
      };
    };
    const successfulUserStream = new UserStream({
      apiKey: "test-key",
      logger: {
        info() {},
        warn(event, metadata) {
          successLogs.push({ event, metadata });
        },
        error() {}
      },
      requestTimeoutMs: 100,
      store: successStore,
      wsManager: {
        publish() {},
        subscribe() {
          return () => {};
        }
      }
    });
    await successfulUserStream.keepAliveListenKey("listen-key-ok");
    const successConnection = successStore.getWsConnections().find((item) => item.connectionId === "user-stream");
    if (!keepAliveSignalProvided || successConnection?.status === "degraded" || successLogs.length > 0) {
      throw new Error(`successful keepalive should still work without degrading health: ${JSON.stringify({ keepAliveSignalProvided, successConnection, successLogs })}`);
    }
  } finally {
    global.fetch = originalFetch;
  }

  try {
    const createSuccessStore = new StateStore();
    let connectedListenKey = null;
    let subscribeCalled = false;
    global.fetch = async (_url, options = {}) => {
      if (!options.signal) {
        throw new Error("listen-key creation should receive an abort signal");
      }
      if (options.method === "DELETE") {
        return {
          ok: true,
          status: 200
        };
      }
      return {
        async json() {
          return { listenKey: "listen-key-created" };
        },
        ok: true,
        status: 200
      };
    };
    const createSuccessUserStream = new UserStream({
      apiKey: "test-key",
      logger: {
        info() {},
        warn() {},
        error() {}
      },
      requestTimeoutMs: 100,
      store: createSuccessStore,
      wsManager: {
        connectBinanceUserStream(params) {
          connectedListenKey = params.listenKey;
          return () => {};
        },
        publish() {},
        subscribe() {
          subscribeCalled = true;
          return () => {};
        }
      }
    });
    await createSuccessUserStream.start({ mode: "live" });
    const createSuccessConnection = createSuccessStore.getWsConnections().find((item) => item.connectionId === "user-stream");
    if (connectedListenKey !== "listen-key-created" || !subscribeCalled || createSuccessConnection?.status !== "connecting") {
      throw new Error(`successful listen-key creation should still connect the user stream: ${JSON.stringify({ connectedListenKey, subscribeCalled, createSuccessConnection })}`);
    }
    await createSuccessUserStream.stop();
  } finally {
    global.fetch = originalFetch;
  }
}

module.exports = {
  runUserStreamTests
};
