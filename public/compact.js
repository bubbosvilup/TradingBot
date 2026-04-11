const refs = {
  abnormalOnly: document.getElementById("abnormal-only"),
  botCount: document.getElementById("bot-count"),
  bots: document.getElementById("bots"),
  botsRunning: document.getElementById("bots-running"),
  closedCount: document.getElementById("closed-count"),
  connection: document.getElementById("connection"),
  drawdown: document.getElementById("drawdown"),
  executionMode: document.getElementById("execution-mode"),
  freshness: document.getElementById("freshness"),
  killSwitch: document.getElementById("kill-switch"),
  lastRisk: document.getElementById("last-risk"),
  lastTrade: document.getElementById("last-trade"),
  manualCount: document.getElementById("manual-count"),
  marketMode: document.getElementById("market-mode"),
  mode: document.getElementById("mode"),
  netPnl: document.getElementById("net-pnl"),
  openCount: document.getElementById("open-count"),
  pausedCount: document.getElementById("paused-count"),
  profitFactor: document.getElementById("profit-factor"),
  realizedPnl: document.getElementById("realized-pnl"),
  riskSummary: document.getElementById("risk-summary"),
  syncStatus: document.getElementById("sync-status"),
  unrealizedPnl: document.getElementById("unrealized-pnl"),
  uptime: document.getElementById("uptime"),
  winRate: document.getElementById("win-rate")
};

const state = {
  abnormalOnly: false,
  bots: [],
  events: [],
  prices: [],
  system: null,
  trades: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactToken(value) {
  return String(value || "n/a")
    .replaceAll("trend_following", "trend")
    .replaceAll("mean_reversion", "revert")
    .replaceAll("max_drawdown_reached", "max_dd")
    .replaceAll("post_loss_architect_latch", "latch")
    .replaceAll("managed_recovery", "recovery")
    .replaceAll("portfolio_max_drawdown_reached", "port_dd")
    .replaceAll("_", " ");
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number.toFixed(1)}%`;
}

function formatNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toFixed(decimals);
}

function formatAge(timestamp) {
  const time = Number(timestamp);
  if (!Number.isFinite(time) || time <= 0) return "n/a";
  const delta = Date.now() - time;
  if (!Number.isFinite(delta) || delta < 0) return "now";
  if (delta < 1000) return "now";
  if (delta < 60000) return `${Math.round(delta / 1000)}s`;
  if (delta < 3600000) return `${Math.round(delta / 60000)}m`;
  return `${Math.round(delta / 3600000)}h`;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "0s";
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  if (value < 3600000) return `${Math.round(value / 60000)}m`;
  return `${(value / 3600000).toFixed(1)}h`;
}

function valueClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "good" : "bad";
}

function statusClass(status, manualResumeRequired) {
  if (manualResumeRequired) return "bad";
  if (status === "running" || status === "connected") return "good";
  if (status === "paused" || status === "reconnecting") return "warn";
  if (status === "error" || status === "disconnected" || status === "stopped") return "bad";
  return "info";
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function getMarketConnection(system) {
  return (system?.wsConnections || []).find((connection) => connection.connectionId === "market-stream")
    || system?.wsConnection
    || null;
}

function getLatestTickAt(prices, bots) {
  const priceTimes = (prices || []).map((price) => asNumber(price.updatedAt, 0));
  const botTimes = (bots || []).map((bot) => asNumber(bot.lastTickAt, 0));
  return Math.max(0, ...priceTimes, ...botTimes);
}

function summarizeTrades(trades) {
  const closed = Array.isArray(trades) ? trades : [];
  const wins = closed.filter((trade) => asNumber(trade.netPnl, 0) > 0).length;
  const grossProfit = closed.filter((trade) => asNumber(trade.netPnl, 0) > 0)
    .reduce((sum, trade) => sum + asNumber(trade.netPnl, 0), 0);
  const grossLoss = Math.abs(closed.filter((trade) => asNumber(trade.netPnl, 0) < 0)
    .reduce((sum, trade) => sum + asNumber(trade.netPnl, 0), 0));
  return {
    count: closed.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    winRate: closed.length > 0 ? (wins / closed.length) * 100 : null
  };
}

function getBotFamily(bot) {
  const architect = bot.architectPublished || bot.architect || bot.architectObserved || bot.architectFallback || null;
  if (architect?.recommendedFamily) return compactToken(architect.recommendedFamily);
  if (bot.syncStatus) return compactToken(bot.syncStatus);
  return "n/a";
}

function getPositionState(bot) {
  if (bot.manualResumeRequired) return { className: "bad", text: "manual" };
  if (bot.status === "paused") return { className: "warn", text: "paused" };
  if (!bot.openPosition) return { className: "muted", text: "flat" };
  if (bot.openPosition.lifecycleMode === "managed_recovery" || bot.openPosition.lifecycleState === "MANAGED_RECOVERY") {
    return { className: "warn", text: "recovery" };
  }
  return { className: "good", text: "open" };
}

function getRiskFlags(bot) {
  const flags = [];
  if (bot.manualResumeRequired) flags.push("manual");
  if (bot.pausedReason) flags.push(compactToken(bot.pausedReason));
  if (bot.postLossArchitectLatchActive) flags.push(`latch${bot.postLossArchitectLatchFreshPublishCount ? `:${bot.postLossArchitectLatchFreshPublishCount}` : ""}`);
  if (bot.openPosition?.managedRecoveryDeferredReason) flags.push(compactToken(bot.openPosition.managedRecoveryDeferredReason));
  if (Number(bot.managedRecoveryConsecutiveCount || 0) > 0) flags.push(`mr:${bot.managedRecoveryConsecutiveCount}`);
  return flags.length > 0 ? flags.join(" | ") : "clear";
}

function getGateSummary(bot) {
  if (Array.isArray(bot.lastDecisionReasons) && bot.lastDecisionReasons.length > 0) {
    return bot.lastDecisionReasons.slice(0, 2).map(compactToken).join(" | ");
  }
  if (bot.cooldownRemainingMs > 0) {
    return `cooldown ${formatDuration(bot.cooldownRemainingMs)}`;
  }
  if (bot.cooldownReason) return compactToken(bot.cooldownReason);
  if (bot.lastDecision) return `${compactToken(bot.lastDecision)} ${formatNumber(bot.lastDecisionConfidence, 2)}`;
  return "n/a";
}

function getActivityAge(bot) {
  const timestamp = Math.max(
    asNumber(bot.lastExecutionAt, 0),
    asNumber(bot.lastTradeAt, 0),
    asNumber(bot.lastEvaluationAt, 0),
    asNumber(bot.lastTickAt, 0)
  );
  return timestamp > 0 ? formatAge(timestamp) : "n/a";
}

function isAbnormal(bot, system) {
  return Boolean(
    system?.portfolioKillSwitch?.triggered
    || bot.openPosition
    || bot.status === "paused"
    || bot.manualResumeRequired
    || bot.postLossArchitectLatchActive
    || bot.openPosition?.lifecycleMode === "managed_recovery"
    || bot.openPosition?.lifecycleState === "MANAGED_RECOVERY"
    || bot.openPosition?.managedRecoveryDeferredReason
    || Number(bot.managedRecoveryConsecutiveCount || 0) > 0
    || (Array.isArray(bot.lastDecisionReasons) && bot.lastDecisionReasons.length > 0)
    || bot.cooldownReason
  );
}

function renderAggregate() {
  const system = state.system;
  const bots = state.bots;
  const portfolio = system?.portfolioKillSwitch || {};
  const realized = Number.isFinite(Number(portfolio.realizedPnl))
    ? Number(portfolio.realizedPnl)
    : bots.reduce((sum, bot) => sum + asNumber(bot.performance?.pnl, 0), 0);
  const unrealized = Number.isFinite(Number(portfolio.unrealizedPnl))
    ? Number(portfolio.unrealizedPnl)
    : bots.reduce((sum, bot) => sum + asNumber(bot.openPosition?.unrealizedPnl, 0), 0);
  const tradeSummary = summarizeTrades(state.trades);
  const marketConnection = getMarketConnection(system);
  const lastTickAt = getLatestTickAt(state.prices, bots);

  setText(refs.mode, `${String(system?.feedMode || "n/a").toUpperCase()} / ${String(system?.executionMode || "paper").toUpperCase()}`);
  setText(refs.marketMode, String(system?.feedMode || "n/a").toUpperCase());
  setText(refs.executionMode, String(system?.executionMode || "paper").toUpperCase());
  setText(refs.uptime, formatDuration(system?.uptimeMs));
  setText(refs.freshness, lastTickAt ? `${formatAge(lastTickAt)} ago` : "n/a");
  setText(refs.connection, marketConnection?.status || "unknown");
  refs.connection.className = statusClass(marketConnection?.status);
  setText(refs.botsRunning, `${system?.botsRunning ?? 0}/${system?.botsTotal ?? bots.length}`);
  setText(refs.openCount, String(system?.openPositions ?? portfolio.openPositionCount ?? 0));

  setText(refs.netPnl, formatMoney(realized + unrealized));
  refs.netPnl.className = valueClass(realized + unrealized);
  setText(refs.realizedPnl, formatMoney(realized));
  refs.realizedPnl.className = valueClass(realized);
  setText(refs.unrealizedPnl, formatMoney(unrealized));
  refs.unrealizedPnl.className = valueClass(unrealized);
  setText(refs.drawdown, formatPercent(portfolio.drawdownPct));
  refs.drawdown.className = asNumber(portfolio.drawdownPct, 0) > 0 ? "warn" : "";
  setText(refs.closedCount, String(tradeSummary.count));
  setText(refs.winRate, tradeSummary.winRate === null ? "n/a" : formatPercent(tradeSummary.winRate));
  setText(refs.profitFactor, tradeSummary.profitFactor === Infinity ? "inf" : formatNumber(tradeSummary.profitFactor, 2));

  setText(refs.killSwitch, portfolio.triggered ? "ACTIVE" : portfolio.enabled ? "armed" : "off");
  refs.killSwitch.className = portfolio.triggered ? "bad" : portfolio.enabled ? "good" : "warn";
  setText(refs.pausedCount, String(system?.botsPaused ?? bots.filter((bot) => bot.status === "paused").length));
  setText(refs.manualCount, String(system?.botsManualResumeRequired ?? bots.filter((bot) => bot.manualResumeRequired).length));
  const riskSummary = portfolio.triggered
    ? compactToken(portfolio.reason || "portfolio kill switch")
    : Number(system?.botsManualResumeRequired || 0) > 0
      ? `${system.botsManualResumeRequired} manual resume`
      : Number(system?.botsPaused || 0) > 0
        ? `${system.botsPaused} paused`
        : "clear";
  setText(refs.riskSummary, riskSummary);
  refs.riskSummary.className = portfolio.triggered ? "bad" : riskSummary === "clear" ? "good" : "warn";
}

function renderBots() {
  const visibleBots = state.abnormalOnly
    ? state.bots.filter((bot) => isAbnormal(bot, state.system))
    : state.bots;
  setText(refs.botCount, `${visibleBots.length}/${state.bots.length} shown`);
  if (!visibleBots.length) {
    refs.bots.innerHTML = '<p class="empty">No abnormal bots.</p>';
    return;
  }

  refs.bots.innerHTML = visibleBots.map((bot) => {
    const position = getPositionState(bot);
    const riskFlags = getRiskFlags(bot);
    const gate = getGateSummary(bot);
    const abnormal = isAbnormal(bot, state.system);
    const statusText = bot.manualResumeRequired ? "manual" : compactToken(bot.status || "idle");
    const recoveryTitle = bot.openPosition?.managedRecoveryDeferredReason
      ? `Recovery reason: ${bot.openPosition.managedRecoveryDeferredReason}`
      : "";
    return `
      <div class="bot-row" role="row" data-abnormal="${String(abnormal)}">
        <span class="bot-cell" title="${escapeHtml(bot.botId || "bot")}">${escapeHtml(bot.botId || "bot")}</span>
        <span class="bot-cell" title="${escapeHtml(bot.symbol || "n/a")}">${escapeHtml(bot.symbol || "n/a")}</span>
        <span class="bot-cell" title="${escapeHtml(bot.activeStrategyId || "n/a")}">${escapeHtml(bot.activeStrategyId || "n/a")}</span>
        <span class="bot-cell" title="${escapeHtml(getBotFamily(bot))}">${escapeHtml(getBotFamily(bot))}</span>
        <span class="bot-cell" title="${escapeHtml(recoveryTitle)}">
          <span class="badge ${position.className}">${escapeHtml(position.text)}</span>
          <span class="badge ${statusClass(bot.status, bot.manualResumeRequired)}">${escapeHtml(statusText)}</span>
        </span>
        <span class="bot-cell ${riskFlags === "clear" ? "good" : "warn"}" title="${escapeHtml(riskFlags)}">${escapeHtml(riskFlags)}</span>
        <span class="bot-cell" title="${escapeHtml(gate)}">${escapeHtml(gate)}</span>
        <span class="bot-cell muted">${escapeHtml(getActivityAge(bot))}</span>
      </div>
    `;
  }).join("");
}

function isRiskEvent(event) {
  const message = String(event?.message || "").toLowerCase();
  return message.includes("risk")
    || message.includes("drawdown")
    || message.includes("kill")
    || message.includes("pause")
    || message.includes("recovery")
    || message.includes("latch")
    || message.includes("blocked");
}

function renderLastRows() {
  const lastTrade = Array.isArray(state.trades) && state.trades.length > 0 ? state.trades[0] : null;
  const tradeText = lastTrade
    ? `${lastTrade.botId} ${lastTrade.symbol} ${formatMoney(lastTrade.netPnl)} ${formatAge(lastTrade.exitTime)} ago`
    : "none";
  const riskEvent = (state.events || []).find(isRiskEvent) || null;
  const riskText = riskEvent
    ? `${compactToken(riskEvent.message)} ${formatAge(riskEvent.time)} ago`
    : refs.riskSummary.textContent || "clear";
  setText(refs.lastTrade, tradeText);
  refs.lastTrade.className = lastTrade ? valueClass(lastTrade.netPnl) : "";
  setText(refs.lastRisk, riskText);
  refs.lastRisk.className = riskEvent?.level === "ERROR" ? "bad" : riskEvent ? "warn" : refs.riskSummary.className;
}

function render() {
  renderAggregate();
  renderBots();
  renderLastRows();
}

async function refresh() {
  try {
    const [system, bots, prices, trades, events] = await Promise.all([
      fetchJson("/api/system"),
      fetchJson("/api/bots"),
      fetchJson("/api/prices"),
      fetchJson("/api/trades"),
      fetchJson("/api/events")
    ]);
    state.system = system;
    state.bots = Array.isArray(bots) ? bots : [];
    state.prices = Array.isArray(prices) ? prices : [];
    state.trades = Array.isArray(trades) ? trades : [];
    state.events = Array.isArray(events) ? events : [];
    render();
    setText(refs.syncStatus, `synced ${new Date().toLocaleTimeString()}`);
    refs.syncStatus.className = "good";
  } catch (error) {
    setText(refs.syncStatus, error?.message || "refresh failed");
    refs.syncStatus.className = "bad";
  }
}

refs.abnormalOnly.addEventListener("change", () => {
  state.abnormalOnly = Boolean(refs.abnormalOnly.checked);
  renderBots();
});

void refresh();
setInterval(() => {
  void refresh();
}, 1500);
