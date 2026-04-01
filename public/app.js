const refs = {
  botsBody: document.getElementById("bots-body"),
  chartLegend: document.getElementById("chart-legend"),
  comparisonNode: document.getElementById("comparison-chart"),
  drawdownNode: document.getElementById("drawdown-chart"),
  eventsList: document.getElementById("events-list"),
  focusChart: document.getElementById("focus-chart"),
  focusMeta: document.getElementById("focus-meta"),
  focusSymbol: document.getElementById("focus-symbol"),
  focusTitle: document.getElementById("focus-title"),
  healthStack: document.getElementById("health-stack"),
  historyBody: document.getElementById("history-body"),
  historyCloseButton: document.getElementById("history-close-button"),
  historyFilterBot: document.getElementById("history-filter-bot"),
  historyFilterResult: document.getElementById("history-filter-result"),
  historyFilterSymbol: document.getElementById("history-filter-symbol"),
  historyModal: document.getElementById("history-modal"),
  historyNote: document.getElementById("history-note"),
  latencyPill: document.getElementById("latency-pill"),
  modePill: document.getElementById("mode-pill"),
  pnlNode: document.getElementById("pnl-chart"),
  positionsBody: document.getElementById("positions-body"),
  pricesList: document.getElementById("prices-list"),
  refreshButton: document.getElementById("refresh-button"),
  refreshStatus: document.getElementById("refresh-status"),
  systemCards: document.getElementById("system-cards"),
  systemNote: document.getElementById("system-note"),
  timeframeGroup: document.getElementById("timeframe-group"),
  tradeHistoryButton: document.getElementById("trade-history-button"),
  tradeHistoryButtonInline: document.getElementById("trade-history-button-inline"),
  wsPill: document.getElementById("ws-pill")
};

const state = {
  analytics: null,
  bots: [],
  chart: null,
  chartPayload: null,
  events: [],
  focusSymbol: null,
  history: {
    filters: {
      botId: "all",
      result: "all",
      symbol: "all"
    },
    isOpen: false,
    selectedBotId: null,
    trades: []
  },
  inFlight: {
    analytics: false,
    chart: false,
    snapshot: false,
    trades: false
  },
  positions: [],
  prices: [],
  system: null,
  timeframe: "1m"
};

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "n/a";
  return Number(value).toFixed(decimals);
}

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "n/a";
  const number = Number(value);
  if (Math.abs(number) >= 1000) return number.toFixed(2);
  if (Math.abs(number) >= 1) return number.toFixed(4);
  return number.toFixed(6);
}

function formatSigned(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "n/a";
  const number = Number(value);
  const fixed = number.toFixed(decimals);
  return `${number > 0 ? "+" : ""}${fixed}`;
}

function formatRelative(value) {
  if (!value) return "n/a";
  const delta = Date.now() - Number(value);
  if (!Number.isFinite(delta)) return "n/a";
  if (delta < 1000) return "now";
  if (delta < 60000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3600000) return `${Math.round(delta / 60000)}m ago`;
  return `${Math.round(delta / 3600000)}h ago`;
}

function formatDateTime(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function formatDuration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "ready";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function numberClass(value) {
  if (!Number.isFinite(Number(value))) return "";
  if (Number(value) > 0) return "value-positive";
  if (Number(value) < 0) return "value-negative";
  return "";
}

function badgeClass(status) {
  if (status === "connected" || status === "running" || status === "mocking") return "badge badge-positive";
  if (status === "reconnecting" || status === "paused") return "badge badge-warning";
  if (status === "error" || status === "disconnected" || status === "stopped") return "badge badge-negative";
  return "badge";
}

function setText(node, value) {
  if (node) node.textContent = value;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function getMarketConnection(system) {
  if (!system) return null;
  return (system.wsConnections || []).find((connection) => connection.connectionId === "market-stream") || system.wsConnection || null;
}

function getUserConnection(system) {
  if (!system) return null;
  return (system.wsConnections || []).find((connection) => connection.connectionId === "user-stream") || null;
}

function pickFocusSymbol() {
  const availableSymbols = [...new Set(state.bots.map((bot) => bot.symbol))];
  if (state.focusSymbol && availableSymbols.includes(state.focusSymbol)) {
    return state.focusSymbol;
  }
  const positionSymbol = state.positions[0]?.symbol;
  if (positionSymbol) return positionSymbol;
  const hotBot = state.bots.find((bot) => bot.openPosition) || state.bots.find((bot) => bot.status === "running");
  return hotBot?.symbol || availableSymbols[0] || null;
}

function ensureFocusSymbol() {
  const nextFocus = pickFocusSymbol();
  state.focusSymbol = nextFocus;
  const symbols = [...new Set(state.bots.map((bot) => bot.symbol))];
  refs.focusSymbol.innerHTML = symbols.map((symbol) => `
    <option value="${escapeHtml(symbol)}" ${symbol === nextFocus ? "selected" : ""}>${escapeHtml(symbol)}</option>
  `).join("");
}

function renderSystemCards() {
  if (!state.system) return;
  const system = state.system;
  const marketConnection = getMarketConnection(system);
  const metrics = [
    {
      label: "Bots running",
      note: `${system.botsTotal} configured`,
      value: system.botsRunning
    },
    {
      label: "Open positions",
      note: "Across all bots",
      value: system.openPositions
    },
    {
      label: "Market stream",
      note: marketConnection?.lastReason || "Primary feed state",
      value: marketConnection?.status || "unknown"
    },
    {
      label: "Uptime",
      note: `Started ${formatDateTime(system.startedAt)}`,
      value: formatDuration(system.uptimeMs)
    }
  ];

  refs.systemCards.innerHTML = metrics.map((item) => `
    <article class="mini-card">
      <span class="mini-label">${escapeHtml(item.label)}</span>
      <strong class="mini-value">${escapeHtml(item.value)}</strong>
      <span class="mini-note">${escapeHtml(item.note)}</span>
    </article>
  `).join("");
}

function renderHealth() {
  if (!state.system) return;
  const marketConnection = getMarketConnection(state.system);
  const userConnection = getUserConnection(state.system);
  const latency = state.system.latency || null;

  setText(refs.modePill, String(state.system.feedMode || "n/a").toUpperCase());
  setText(refs.wsPill, marketConnection?.status || "n/a");
  setText(refs.latencyPill, latency?.totalPipelineMs ? `${Math.round(latency.totalPipelineMs)}ms` : "n/a");

  refs.healthStack.innerHTML = `
    <div class="health-item">
      <div>
        <strong>Market WS</strong>
        <p>${escapeHtml(marketConnection?.lastReason || "Primary price feed status")}</p>
      </div>
      <span class="${badgeClass(marketConnection?.status)}">${escapeHtml(marketConnection?.status || "unknown")}</span>
    </div>
    <div class="health-item">
      <div>
        <strong>User stream</strong>
        <p>${escapeHtml(userConnection?.lastReason || "Order / balance event stream")}</p>
      </div>
      <span class="${badgeClass(userConnection?.status)}">${escapeHtml(userConnection?.status || "inactive")}</span>
    </div>
    <div class="pipeline-grid">
      <article class="pipeline-item">
        <span>Exchange -> WS</span>
        <strong>${latency?.exchangeToReceiveMs ? `${Math.round(latency.exchangeToReceiveMs)}ms` : "n/a"}</strong>
      </article>
      <article class="pipeline-item">
        <span>WS -> Store</span>
        <strong>${latency?.receiveToStateMs ? `${Math.round(latency.receiveToStateMs)}ms` : "n/a"}</strong>
      </article>
      <article class="pipeline-item">
        <span>Store -> Bot</span>
        <strong>${latency?.stateToBotMs ? `${Math.round(latency.stateToBotMs)}ms` : "n/a"}</strong>
      </article>
      <article class="pipeline-item">
        <span>Bot -> Exec</span>
        <strong>${latency?.botToExecutionMs ? `${Math.round(latency.botToExecutionMs)}ms` : "n/a"}</strong>
      </article>
    </div>
  `;
}

function renderFocusMeta() {
  const focusBot = state.bots.find((bot) => bot.symbol === state.focusSymbol) || null;
  const focusPosition = state.positions.find((position) => position.symbol === state.focusSymbol) || null;
  const latency = focusBot?.latency || state.system?.latency || null;

  setText(refs.focusTitle, state.focusSymbol || "No symbol selected");
  refs.focusMeta.innerHTML = [
    { label: "Strategy", value: focusBot?.activeStrategyId || "n/a" },
    { label: "Status", value: focusBot?.status || "n/a" },
    { label: "Price", value: formatPrice(focusBot?.price ?? state.chartPayload?.lastPrice) },
    { label: "Position", value: focusPosition ? `${formatNumber(focusPosition.quantity, 6)} @ ${formatPrice(focusPosition.entryPrice)}` : "Flat" },
    { label: "Cooldown", value: focusBot?.cooldownRemainingMs > 0 ? formatDuration(focusBot.cooldownRemainingMs) : "Ready" },
    { label: "PnL / Win", value: `${formatSigned(focusBot?.performance?.pnl)} / ${formatNumber(focusBot?.performance?.winRate, 1)}%` },
    { label: "Drawdown", value: `${formatNumber(focusBot?.performance?.drawdown, 2)}%` },
    { label: "Pipeline", value: latency?.totalPipelineMs ? `${Math.round(latency.totalPipelineMs)}ms` : "n/a" }
  ].map((item) => `
    <article class="focus-stat">
      <span class="focus-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </article>
  `).join("");
}

function renderBots() {
  if (!state.bots.length) {
    refs.botsBody.innerHTML = '<tr><td colspan="11">No active bots.</td></tr>';
    return;
  }

  refs.botsBody.innerHTML = state.bots.map((bot) => {
    const positionSummary = bot.openPosition
      ? `${formatPrice(bot.openPosition.entryPrice)} / ${formatSigned(bot.openPosition.unrealizedPnl)}`
      : "Flat";
    const cooldown = bot.cooldownRemainingMs > 0
      ? `${formatDuration(bot.cooldownRemainingMs)}${bot.cooldownReason ? ` (${bot.cooldownReason})` : ""}`
      : "Ready";
    const decisionSummary = Array.isArray(bot.lastDecisionReasons) && bot.lastDecisionReasons.length > 0
      ? bot.lastDecisionReasons.slice(0, 2).join(" | ")
      : "No blockers";
    return `
      <tr class="bot-row ${bot.symbol === state.focusSymbol ? "is-selected" : ""}" data-symbol="${escapeHtml(bot.symbol)}">
        <td>
          <div class="cell-stack">
            <strong>${escapeHtml(bot.botId)}</strong>
            <span class="muted">${escapeHtml(bot.symbol)}</span>
          </div>
        </td>
        <td><span class="${badgeClass(bot.status)}">${escapeHtml(bot.status)}</span></td>
        <td>${escapeHtml(bot.activeStrategyId)}</td>
        <td>${formatPrice(bot.price)}</td>
        <td>${escapeHtml(cooldown)}</td>
        <td>${escapeHtml(positionSummary)}</td>
        <td class="${numberClass(bot.performance?.pnl)}">${formatSigned(bot.performance?.pnl)}</td>
        <td>${formatNumber(bot.performance?.drawdown, 2)}%</td>
        <td>${formatNumber(bot.performance?.winRate, 1)}%</td>
        <td>
          <div class="cell-stack">
            <strong>${escapeHtml(bot.lastDecision)} (${formatNumber(bot.lastDecisionConfidence, 2)})</strong>
            <span class="muted">${escapeHtml(decisionSummary)}</span>
          </div>
        </td>
        <td>
          <button type="button" class="button-secondary table-action" data-history-bot="${escapeHtml(bot.botId)}">History</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderPositions() {
  if (!state.positions.length) {
    refs.positionsBody.innerHTML = '<tr><td colspan="7">No open positions.</td></tr>';
    return;
  }

  refs.positionsBody.innerHTML = state.positions.map((position) => `
    <tr>
      <td>${escapeHtml(position.botId)}</td>
      <td>${escapeHtml(position.symbol)}</td>
      <td>${formatPrice(position.entryPrice)}</td>
      <td>${formatPrice(position.currentPrice)}</td>
      <td>${formatNumber(position.quantity, 6)}</td>
      <td>${escapeHtml(formatDuration(position.holdMs))}</td>
      <td class="${numberClass(position.unrealizedPnl)}">${formatSigned(position.unrealizedPnl)}</td>
    </tr>
  `).join("");
}

function renderPrices() {
  if (!state.prices.length) {
    refs.pricesList.innerHTML = '<p class="empty-state">No prices available.</p>';
    return;
  }

  refs.pricesList.innerHTML = state.prices.map((item) => `
    <article class="price-item ${item.symbol === state.focusSymbol ? "is-selected" : ""}" data-symbol="${escapeHtml(item.symbol)}">
      <div>
        <strong>${escapeHtml(item.symbol)}</strong>
        <p>${escapeHtml(formatRelative(item.updatedAt))}</p>
      </div>
      <span>${formatPrice(item.price)}</span>
    </article>
  `).join("");
}

function renderEvents() {
  if (!state.events.length) {
    refs.eventsList.innerHTML = '<p class="empty-state">No events yet.</p>';
    return;
  }

  refs.eventsList.innerHTML = state.events.map((event) => {
    const metadata = Object.entries(event.metadata || {})
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" | ");
    return `
      <article class="event-item">
        <div class="event-topline">
          <strong>${escapeHtml(event.scope)}</strong>
          <span class="${badgeClass(event.level === "ERROR" ? "error" : event.level === "WARN" ? "paused" : "running")}">${escapeHtml(event.level)}</span>
          <span class="muted">${escapeHtml(formatRelative(event.time))}</span>
        </div>
        <p>${escapeHtml(event.message)}</p>
        <p class="muted">${escapeHtml(metadata || "no metadata")}</p>
      </article>
    `;
  }).join("");
}

function renderHistoryFilters() {
  const botOptions = ["<option value=\"all\">All bots</option>"].concat(
    state.bots.map((bot) => `<option value="${escapeHtml(bot.botId)}">${escapeHtml(bot.botId)}</option>`)
  );
  const symbolOptions = ["<option value=\"all\">All symbols</option>"].concat(
    [...new Set(state.history.trades.map((trade) => trade.symbol))].sort().map((symbol) => `<option value="${escapeHtml(symbol)}">${escapeHtml(symbol)}</option>`)
  );

  refs.historyFilterBot.innerHTML = botOptions.join("");
  refs.historyFilterSymbol.innerHTML = symbolOptions.join("");
  refs.historyFilterBot.value = state.history.filters.botId;
  refs.historyFilterSymbol.value = state.history.filters.symbol;
  refs.historyFilterResult.value = state.history.filters.result;
}

function getFilteredTrades() {
  return state.history.trades.filter((trade) => {
    if (state.history.filters.botId !== "all" && trade.botId !== state.history.filters.botId) return false;
    if (state.history.filters.symbol !== "all" && trade.symbol !== state.history.filters.symbol) return false;
    if (state.history.filters.result !== "all" && trade.result !== state.history.filters.result) return false;
    return true;
  });
}

function renderTradeHistory() {
  renderHistoryFilters();
  const trades = getFilteredTrades();
  refs.historyNote.textContent = trades.length > 0
    ? `${trades.length} completed trade${trades.length === 1 ? "" : "s"} visible. Newest first.`
    : "No completed trades match the current filters.";

  if (trades.length <= 0) {
    refs.historyBody.innerHTML = '<tr><td colspan="13">No completed trades yet.</td></tr>';
    return;
  }

  refs.historyBody.innerHTML = trades.map((trade) => `
    <tr>
      <td>${escapeHtml(trade.botName || trade.botId)}</td>
      <td>${escapeHtml(trade.symbol)}</td>
      <td>${escapeHtml(String(trade.side || "long").toUpperCase())}</td>
      <td>${escapeHtml(formatDateTime(trade.entryTime))}</td>
      <td>${escapeHtml(formatDateTime(trade.exitTime))}</td>
      <td>${formatPrice(trade.entryPrice)}</td>
      <td>${formatPrice(trade.exitPrice)}</td>
      <td>${formatNumber(trade.quantity, 6)}</td>
      <td>${escapeHtml(formatDuration(trade.holdMs))}</td>
      <td class="${numberClass(trade.grossPnl)}">${formatSigned(trade.grossPnl)}</td>
      <td>${formatSigned(trade.fees)}</td>
      <td class="${numberClass(trade.netPnl)}">${formatSigned(trade.netPnl)}</td>
      <td>
        <div class="reason-block">
          <strong>Entry</strong>
          <span>${escapeHtml((trade.entryReason || []).join(" | ") || "n/a")}</span>
          <strong>Exit</strong>
          <span>${escapeHtml((trade.exitReason || []).join(" | ") || "n/a")}</span>
        </div>
      </td>
    </tr>
  `).join("");
}

function setHistoryVisibility(isOpen) {
  state.history.isOpen = isOpen;
  refs.historyModal.classList.toggle("is-hidden", !isOpen);
  refs.historyModal.setAttribute("aria-hidden", String(!isOpen));
}

async function loadTradesHistory(force = false) {
  if (state.inFlight.trades) return;
  if (!force && state.history.trades.length > 0 && !state.history.isOpen) return;
  state.inFlight.trades = true;
  try {
    state.history.trades = await fetchJson("/api/trades");
    if (state.history.isOpen) {
      renderTradeHistory();
    }
  } catch (error) {
    if (state.history.isOpen) {
      refs.historyNote.textContent = error?.message || "Unable to load closed trades.";
    }
  } finally {
    state.inFlight.trades = false;
  }
}

function openHistoryModal(options = {}) {
  state.history.filters.botId = options.botId || "all";
  state.history.filters.symbol = options.symbol || "all";
  state.history.filters.result = options.result || "all";
  setHistoryVisibility(true);
  renderTradeHistory();
  void loadTradesHistory(true);
}

function closeHistoryModal() {
  setHistoryVisibility(false);
}

function wireInteractiveRows() {
  refs.botsBody.querySelectorAll("[data-symbol]").forEach((row) => {
    row.addEventListener("click", () => {
      state.focusSymbol = row.getAttribute("data-symbol");
      ensureFocusSymbol();
      renderBots();
      renderPrices();
      renderFocusMeta();
      void loadChart();
    });
  });

  refs.botsBody.querySelectorAll("[data-history-bot]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openHistoryModal({ botId: button.getAttribute("data-history-bot") });
    });
  });

  refs.pricesList.querySelectorAll("[data-symbol]").forEach((row) => {
    row.addEventListener("click", () => {
      state.focusSymbol = row.getAttribute("data-symbol");
      ensureFocusSymbol();
      renderBots();
      renderPrices();
      renderFocusMeta();
      void loadChart();
    });
  });
}

function ensureAdapters() {
  if (!state.chart && window.ChartAdapter && window.LightweightCharts) {
    state.chart = window.ChartAdapter.create({
      container: refs.focusChart,
      legendNode: refs.chartLegend,
      titleNode: refs.focusTitle
    });
  }
  if (!state.analytics && window.DashboardAdapter && window.echarts) {
    state.analytics = window.DashboardAdapter.create({
      comparisonNode: refs.comparisonNode,
      drawdownNode: refs.drawdownNode,
      pnlNode: refs.pnlNode
    });
  }
}

async function loadSnapshot() {
  if (state.inFlight.snapshot) return;
  state.inFlight.snapshot = true;
  refs.refreshButton.disabled = true;
  refs.refreshStatus.textContent = "Refreshing runtime...";

  try {
    const [system, bots, prices, positions, events] = await Promise.all([
      fetchJson("/api/system"),
      fetchJson("/api/bots"),
      fetchJson("/api/prices"),
      fetchJson("/api/positions"),
      fetchJson("/api/events")
    ]);

    state.system = system;
    state.bots = bots;
    state.prices = prices;
    state.positions = positions;
    state.events = events;
    ensureFocusSymbol();
    ensureAdapters();
    renderSystemCards();
    renderHealth();
    renderFocusMeta();
    renderBots();
    renderPositions();
    renderPrices();
    renderEvents();
    if (state.history.isOpen) {
      renderTradeHistory();
      void loadTradesHistory(true);
    }
    wireInteractiveRows();

    const marketConnection = getMarketConnection(system);
    const userConnection = getUserConnection(system);
    refs.systemNote.textContent = `Mode ${system.feedMode}. Market WS ${marketConnection?.status || "unknown"}, user stream ${userConnection?.status || "inactive"}.`;
    refs.refreshStatus.textContent = `Last sync ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    refs.systemNote.textContent = "Unable to read orchestrator state.";
    refs.refreshStatus.textContent = error?.message || "Refresh failed.";
  } finally {
    refs.refreshButton.disabled = false;
    state.inFlight.snapshot = false;
  }
}

async function loadChart() {
  if (state.inFlight.chart || !state.focusSymbol) return;
  state.inFlight.chart = true;
  try {
    const payload = await fetchJson(`/api/chart?symbol=${encodeURIComponent(state.focusSymbol)}`);
    state.chartPayload = payload;
    if (state.chart) {
      state.chart.update(payload);
    }
    renderFocusMeta();
  } catch (error) {
    refs.chartLegend.innerHTML = `<span>${escapeHtml(error?.message || "Chart unavailable")}</span>`;
  } finally {
    state.inFlight.chart = false;
  }
}

async function loadAnalytics() {
  if (state.inFlight.analytics || !state.analytics) return;
  state.inFlight.analytics = true;
  try {
    const payload = await fetchJson("/api/analytics");
    state.analytics.update(payload);
  } catch {
    // analytics errors stay silent; summary widgets already expose runtime health
  } finally {
    state.inFlight.analytics = false;
  }
}

refs.refreshButton.addEventListener("click", () => {
  void loadSnapshot();
  void loadChart();
  void loadAnalytics();
});

refs.tradeHistoryButton.addEventListener("click", () => {
  openHistoryModal();
});
refs.tradeHistoryButtonInline.addEventListener("click", () => {
  openHistoryModal();
});
refs.historyCloseButton.addEventListener("click", () => {
  closeHistoryModal();
});
refs.historyModal.addEventListener("click", (event) => {
  const closer = event.target.closest("[data-close-modal='true']");
  if (closer) {
    closeHistoryModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.history.isOpen) {
    closeHistoryModal();
  }
});

refs.historyFilterBot.addEventListener("change", () => {
  state.history.filters.botId = refs.historyFilterBot.value || "all";
  renderTradeHistory();
});
refs.historyFilterSymbol.addEventListener("change", () => {
  state.history.filters.symbol = refs.historyFilterSymbol.value || "all";
  renderTradeHistory();
});
refs.historyFilterResult.addEventListener("change", () => {
  state.history.filters.result = refs.historyFilterResult.value || "all";
  renderTradeHistory();
});

refs.focusSymbol.addEventListener("change", () => {
  state.focusSymbol = refs.focusSymbol.value || null;
  renderBots();
  renderPrices();
  renderFocusMeta();
  void loadChart();
});

refs.timeframeGroup.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeframe]");
  if (!button) return;
  state.timeframe = button.getAttribute("data-timeframe");
  refs.timeframeGroup.querySelectorAll("[data-timeframe]").forEach((node) => {
    node.classList.toggle("is-active", node === button);
  });
  if (state.chart) {
    state.chart.setTimeframe(state.timeframe);
  }
  void loadChart();
});

ensureAdapters();
void loadSnapshot();
void loadChart();
void loadAnalytics();
setInterval(() => {
  void loadSnapshot();
}, 1000);
setInterval(() => {
  void loadChart();
}, 1000);
setInterval(() => {
  void loadAnalytics();
}, 2000);
