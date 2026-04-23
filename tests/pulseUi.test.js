"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createElement() {
  return {
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    closest() {
      return null;
    },
    dataset: {},
    disabled: false,
    getAttribute(name) {
      return this[name];
    },
    innerHTML: "",
    removeAttribute() {},
    setAttribute() {},
    showModal() {},
    textContent: "",
    title: ""
  };
}

async function runPulseUiTests() {
  const fetchCalls = [];
  const elements = new Map([
    ["bot-cards", createElement()],
    ["focus-architect", createElement()],
    ["focus-events", createElement()],
    ["focus-symbol-note", createElement()],
    ["focus-title", createElement()],
    ["history-button", createElement()],
    ["history-close", createElement()],
    ["history-dialog", createElement()],
    ["history-list", createElement()],
    ["history-title", createElement()],
    ["position-details", createElement()],
    ["refresh-status", createElement()],
    ["resume-button", createElement()],
    ["status-bots", createElement()],
    ["status-execution", createElement()],
    ["status-feed", createElement()],
    ["status-kill", createElement()],
    ["status-kill-shell", createElement()],
    ["status-pnl", createElement()],
    ["status-positions", createElement()],
    ["status-stream", createElement()],
    ["status-tick-age", createElement()]
  ]);

  let streamInstance = null;
  function EventSource() {
    streamInstance = this;
    this.close = function close() {};
  }

  const context = {
    EventSource,
    clearInterval() {},
    console,
    document: {
      getElementById(id) {
        return elements.get(id) || null;
      }
    },
    fetch(url) {
      fetchCalls.push(String(url));
      if (String(url).startsWith("/api/events")) {
        return Promise.resolve({
          json: async () => ([{
            level: "INFO",
            message: "bot resumed sync",
            time: 1_700_000_000_000
          }]),
          ok: true
        });
      }
      return Promise.resolve({
        json: async () => ({}),
        ok: true
      });
    },
    setInterval() {
      return 1;
    },
    window: {
      ChartAdapter: {
        create() {
          throw new Error("Pulse UI should not depend on ChartAdapter after chart removal");
        }
      },
      EventSource
    }
  };

  const source = fs.readFileSync(path.join(__dirname, "..", "public", "pulse.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "pulse.js" });

  streamInstance.onmessage({
    data: JSON.stringify({
      botCards: [{
        botId: "bot_a",
        position: {
          label: "LONG +$12.00",
          pnlUsdt: 12,
          state: "long"
        },
        symbol: "BTC/USDT"
      }],
      focusPanel: {
        actions: {
          history: { enabled: true, visible: true },
          resume: { enabled: false, visible: false }
        },
        architect: { line: "trend regime . trend-following bias . strength 0.18" },
        botId: "bot_a",
        symbol: "BTC/USDT"
      },
      latestPrice: 67000.12,
      statusBar: {
        bots: { running: 1, total: 1 },
        executionMode: "PAPER",
        feedMode: "LIVE",
        killSwitch: { severity: "normal", state: "armed" },
        marketStream: { status: "connected" },
        netPnlUsdt: 12,
        openPositions: 1
      }
    })
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  if (fetchCalls.some((url) => url.startsWith("/api/chart"))) {
    throw new Error(`Pulse UI should not request chart data after chart removal: ${JSON.stringify(fetchCalls)}`);
  }
  if (!fetchCalls.some((url) => url.startsWith("/api/events?botId=bot_a"))) {
    throw new Error(`Pulse UI should still request recent bot events for the selected bot: ${JSON.stringify(fetchCalls)}`);
  }

  const focusTitle = elements.get("focus-title");
  const focusSymbolNote = elements.get("focus-symbol-note");
  const positionDetails = elements.get("position-details");
  const focusEvents = elements.get("focus-events");

  if (focusTitle.textContent !== "BTC/USDT") {
    throw new Error(`focus panel should still render the selected bot symbol: ${focusTitle.textContent}`);
  }
  if (focusSymbolNote.textContent !== "bot_a") {
    throw new Error(`focus panel should still render the selected bot id: ${focusSymbolNote.textContent}`);
  }
  if (!String(positionDetails.innerHTML).includes("Current") || !String(positionDetails.innerHTML).includes("67000.12")) {
    throw new Error(`focus panel should still render latest price details without a chart: ${positionDetails.innerHTML}`);
  }
  if (!String(focusEvents.innerHTML).includes("bot resumed sync")) {
    throw new Error(`focus panel should still render recent events without a chart: ${focusEvents.innerHTML}`);
  }
}

module.exports = {
  runPulseUiTests
};
