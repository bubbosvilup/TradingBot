const summaryCards = document.getElementById("summary-cards");
const decisionMainFacts = document.getElementById("decision-main-facts");
const currentActionElement = document.getElementById("current-action");
const currentSymbolBadge = document.getElementById("current-symbol-badge");
const marketsBody = document.getElementById("markets-body");
const tradesBody = document.getElementById("trades-body");
const positionsBody = document.getElementById("positions-body");
const summaryElement = document.getElementById("summary");
const shortExplanationElement = document.getElementById("decision-short-explanation");
const detailedExplanationElement = document.getElementById("decision-detailed-explanation");
const reasonListElement = document.getElementById("decision-reason-list");
const resetButton = document.getElementById("reset-button");
const resetResult = document.getElementById("reset-result");
const btcFilterToggle = document.getElementById("btc-filter-toggle");
const aggressiveModeToggle = document.getElementById("aggressive-mode-toggle");
const watchlistOverview = document.getElementById("watchlist-overview");
const activeWatchlist = document.getElementById("active-watchlist");
const hotPool = document.getElementById("hot-pool");
const swapTimeline = document.getElementById("swap-timeline");
const runtimeFacts = document.getElementById("runtime-facts");
const performanceFacts = document.getElementById("performance-facts");
const engineBreakdownBody = document.getElementById("engine-breakdown-body");
const researchSummary = document.getElementById("research-summary");
const strategyModesBody = document.getElementById("strategy-modes-body");
const researchSymbolsBody = document.getElementById("research-symbols-body");
const researchModeChips = document.getElementById("research-mode-chips");
const simulatedRoundsBody = document.getElementById("simulated-rounds-body");
const backtestLog = document.getElementById("backtest-log");
const runBacktestButton = document.getElementById("run-backtest-button");
const backtestRunStatus = document.getElementById("backtest-run-status");
const backtestDaysInput = document.getElementById("backtest-days");
const backtestSymbolLimitInput = document.getElementById("backtest-symbol-limit");
const backtestSymbolsInput = document.getElementById("backtest-symbols");
const backtestUseWatchlistToggle = document.getElementById("backtest-use-watchlist-toggle");
const backtestAggressiveToggle = document.getElementById("backtest-aggressive-toggle");
const heroStatusStrip = document.getElementById("hero-status-strip");
const refreshButton = document.getElementById("refresh-button");
const refreshStatus = document.getElementById("refresh-status");
const marketSearch = document.getElementById("market-search");
const marketFilterChips = document.getElementById("market-filter-chips");

const clientState = {
  activeFilter: "all",
  backtestForm: {
    aggressiveMode: false,
    days: 3,
    symbolLimit: 6,
    symbols: "",
    useActiveWatchlist: true
  },
  isRefreshing: false,
  lastPayload: null,
  lastRefreshAt: null,
  refreshError: null,
  selectedResearchMode: null,
  searchQuery: ""
};

const MARKET_FILTERS = [
  { id: "all", label: "Tutti" },
  { id: "focus", label: "Focus" },
  { id: "candidate", label: "Candidati" },
  { id: "weak", label: "Deboli" },
  { id: "position", label: "In posizione" }
];

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }

  const number = Number(value);
  const absolute = Math.abs(number);

  if (absolute >= 1000) return number.toFixed(2);
  if (absolute >= 1) return number.toFixed(4);
  if (absolute >= 0.1) return number.toFixed(5);
  if (absolute >= 0.01) return number.toFixed(6);
  return number.toFixed(8);
}

function formatBtc(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  return Number(value).toFixed(6);
}

function formatUsdt(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  return Number(value).toFixed(2);
}

function formatIndicator(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  return Number(value).toFixed(2);
}

function formatBps(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  return `${Number(value).toFixed(1)} bps`;
}

function formatSignedUsdt(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${formatUsdt(number)}`;
}

function getValueClass(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "";
  }
  const number = Number(value);
  if (number > 0) return "value-positive";
  if (number < 0) return "value-negative";
  return "";
}

function getActionClass(action) {
  if (action === "BUY") return "value-positive";
  if (action === "SELL") return "value-negative";
  if (action === "WAIT") return "value-wait";
  return "";
}

function formatDate(value) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return "n/a";
  const deltaMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(deltaMs)) return "n/a";
  const seconds = Math.max(0, Math.round(deltaMs / 1000));
  if (seconds < 5) return "ora";
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m fa`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h fa`;
}

function formatDurationMs(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }
  const ms = Number(value);
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} m`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFacts(container, entries) {
  container.innerHTML = entries
    .map(([label, value, cssClass]) => `<div class="fact"><dt>${escapeHtml(label)}</dt><dd class="${cssClass || ""}">${value}</dd></div>`)
    .join("");
}

function renderSummaryCards(items) {
  summaryCards.innerHTML = items
    .map((item) => `
      <article class="mini-card">
        <span class="mini-label">${escapeHtml(item.label)}</span>
        <strong class="mini-value ${item.cssClass || ""}">${item.value}</strong>
        ${item.note ? `<span class="mini-note">${escapeHtml(item.note)}</span>` : ""}
      </article>
    `)
    .join("");
}

function renderReasonList(items) {
  if (!items || !items.length) {
    reasonListElement.innerHTML = "<li>Nessun dettaglio disponibile.</li>";
    return;
  }
  reasonListElement.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderHeroStatus(statusData) {
  const runtime = statusData.runtime || {};
  const watchlist = statusData.watchlist || {};
  const backtestReport = statusData.research?.backtestReport || null;
  const chips = [
    { label: "Exchange", value: statusData.bot.exchange || "n/a" },
    { label: "Regime BTC", value: statusData.overview?.btcRegime || "n/a" },
    { label: "Profilo", value: statusData.overview?.aggressiveModeEnabled ? "Aggressivo" : "Normale" },
    { label: "Scan cycle", value: runtime.scanCycle ?? 0 },
    { label: "WS", value: (runtime.realtimeSymbols || []).join(", ") || "REST only" },
    { label: "Rotazione debole", value: `${watchlist.weakThresholdRsi ?? "n/a"} RSI / ${formatDurationMs(watchlist.rotationCadenceMs ?? null)}` },
    { label: "Mode research", value: backtestReport?.recommendedMode || "n/a" }
  ];

  heroStatusStrip.innerHTML = chips
    .map((chip) => `<span class="status-chip"><strong>${escapeHtml(chip.label)}</strong><span>${escapeHtml(chip.value)}</span></span>`)
    .join("");
}

function renderPositions(positions) {
  if (!positions || !positions.length) {
    positionsBody.innerHTML = '<tr><td colspan="7">Nessuna posizione aperta al momento.</td></tr>';
    return;
  }

  positionsBody.innerHTML = positions
    .map((pos) => {
      const pnlClass = getValueClass(pos.pnlUsdt);
      const stopLoss = pos.trailingActive && pos.trailingStop ? pos.trailingStop : pos.stopLoss;

      return `
        <tr>
          <td>
            <div class="symbol-cell">
              <strong>${escapeHtml(pos.symbol)}</strong>
              <span class="badge ${pos.trailingActive ? "badge-best" : "badge-position"}">${pos.trailingActive ? "Trailing" : "Open"}</span>
            </div>
          </td>
          <td>${formatPrice(pos.entryPrice)}</td>
          <td>${formatPrice(pos.lastPrice)}</td>
          <td>${formatBtc(pos.btcAmount)}</td>
          <td class="${pnlClass}">${escapeHtml(pos.pnlLabel)}</td>
          <td>${formatPrice(stopLoss)}</td>
          <td>${pos.takeProfit ? formatPrice(pos.takeProfit) : "n/a"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMarketFilters() {
  marketFilterChips.innerHTML = MARKET_FILTERS.map((filter) => `
    <button
      type="button"
      class="chip-button ${clientState.activeFilter === filter.id ? "chip-active" : ""}"
      data-filter-id="${filter.id}"
    >
      ${escapeHtml(filter.label)}
    </button>
  `).join("");
}

function marketMatchesFilter(market) {
  if (!market) return false;
  if (clientState.searchQuery && !market.symbol.toLowerCase().includes(clientState.searchQuery)) {
    return false;
  }

  switch (clientState.activeFilter) {
    case "focus":
      return market.isFocus === true;
    case "candidate":
      return market.signal === "BUY candidate" || market.isBestCandidate === true;
    case "weak":
      return market.isWeak === true;
    case "position":
      return market.isInPosition === true;
    default:
      return true;
  }
}

function renderMarkets(markets) {
  const filteredMarkets = (markets || []).filter(marketMatchesFilter);
  if (!filteredMarkets.length) {
    marketsBody.innerHTML = '<tr><td colspan="9">Nessun mercato corrisponde ai filtri attivi.</td></tr>';
    return;
  }

  marketsBody.innerHTML = filteredMarkets
    .map((market) => {
      const badges = [
        market.isInPosition ? '<span class="badge badge-position">Posizione aperta</span>' : "",
        market.isBestCandidate ? '<span class="badge badge-best">Migliore opportunita</span>' : "",
        market.isWeak ? '<span class="badge badge-weak">Debole</span>' : "",
        market.isFocus ? '<span class="badge badge-focus">Focus</span>' : ""
      ].filter(Boolean).join("");

      return `
        <tr>
          <td>
            <div class="symbol-cell">
              <span>${escapeHtml(market.symbol)}</span>
              ${badges}
            </div>
          </td>
          <td>${formatPrice(market.lastPrice)}</td>
          <td>${escapeHtml(market.trend || "n/a")}</td>
          <td>${escapeHtml(market.signal || "HOLD")}</td>
          <td>${escapeHtml(market.decisionState || "n/a")} / ${escapeHtml(market.marketRegime || "n/a")}</td>
          <td>${market.score === null || market.score === undefined ? "n/a" : `${market.score} / ${formatIndicator(market.opportunityScore)}`}</td>
          <td>${formatIndicator(market.rsi)}</td>
          <td>${escapeHtml(market.entryEngine || "n/a")}</td>
          <td class="reason-cell">${escapeHtml(market.reason || "n/a")}</td>
        </tr>
      `;
    })
    .join("");
}

function groupTrades(trades) {
  const groups = new Map();

  for (const trade of trades) {
    const id = trade.tradeId || `legacy-${trade.time}-${trade.symbol}`;
    if (!groups.has(id)) {
      groups.set(id, []);
    }
    groups.get(id).push(trade);
  }

  return Array.from(groups.values())
    .map((events) => {
      const sortedEvents = [...events].sort((left, right) => new Date(left.time) - new Date(right.time));
      const first = sortedEvents[0];
      const last = sortedEvents[sortedEvents.length - 1];
      const isClosed = sortedEvents.some((event) => event.action === "SELL_FULL");
      const buys = sortedEvents.filter((event) => event.action === "BUY");
      const totalBtc = buys.reduce((sum, event) => sum + event.btcAmount, 0);
      const totalUsdt = buys.reduce((sum, event) => sum + (event.usdtAmount || event.price * event.btcAmount), 0);
      const avgEntry = totalBtc > 0 ? totalUsdt / totalBtc : first.price;
      const totalPnl = sortedEvents.reduce((sum, event) => sum + (event.netPnlUsdt || 0), 0);
      const startTime = new Date(first.time);
      const endTime = new Date(last.time);
      const durationMs = endTime - startTime;
      const durationMin = Math.floor(durationMs / 60000);

      return {
        duration: isClosed ? (durationMin > 0 ? `${durationMin}m` : "< 1m") : "In corso...",
        entryPrice: avgEntry,
        events: sortedEvents,
        exitPrice: isClosed ? last.price : null,
        lastReason: last.reason,
        pnl: totalPnl,
        startTime,
        status: isClosed ? "Chiuso" : "Aperto",
        symbol: first.symbol
      };
    })
    .sort((left, right) => right.startTime - left.startTime);
}

function renderTrades(trades) {
  if (!tradesBody) return;
  if (!trades.length) {
    tradesBody.innerHTML = '<tr><td colspan="6">Nessuna operazione completata disponibile.</td></tr>';
    return;
  }

  tradesBody.innerHTML = groupTrades(trades)
    .map((round) => {
      const pnlClass = getValueClass(round.pnl);
      const lastEvent = round.events[round.events.length - 1];
      const shortExplanation = escapeHtml(lastEvent.explanationShort || lastEvent.reason || "Dettagli non disponibili.");
      const statusBadge = round.status === "Chiuso"
        ? '<span class="badge badge-wait">Chiuso</span>'
        : '<span class="badge badge-position">In corso</span>';

      return `
        <tr>
          <td>${formatDate(round.startTime)}</td>
          <td><strong>${escapeHtml(round.symbol)}</strong></td>
          <td>${statusBadge}</td>
          <td>
            <div class="trade-action-cell">
              <span>${formatPrice(round.entryPrice)} / ${round.exitPrice ? formatPrice(round.exitPrice) : "---"}</span>
              <details class="trade-info">
                <summary class="info-chip" title="Dettagli operazione">i</summary>
                <div class="trade-tooltip">
                  <strong>Status: ${escapeHtml(round.status)}</strong>
                  <p>${shortExplanation}</p>
                  <p>Motivo: ${escapeHtml(round.lastReason || "Nessuno")}</p>
                  <p>Eventi: ${round.events.length}</p>
                </div>
              </details>
            </div>
          </td>
          <td>${escapeHtml(round.duration)}</td>
          <td class="${pnlClass}">${round.status === "Chiuso" ? formatSignedUsdt(round.pnl) : "---"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderActiveWatchlist(items) {
  if (!items || !items.length) {
    activeWatchlist.innerHTML = '<p class="empty-state">Nessun simbolo attivo.</p>';
    return;
  }

  activeWatchlist.innerHTML = items.map((item) => `
    <article class="token-card ${item.isFocus ? "token-focus" : ""} ${item.isWeak ? "token-weak" : ""}">
      <div class="token-title-row">
        <strong>${escapeHtml(item.symbol)}</strong>
        <span class="token-rsi">${formatIndicator(item.rsi)}</span>
      </div>
      <div class="token-meta-row">
        <span>${escapeHtml(item.signal || "HOLD")}</span>
        <span>Opp ${formatIndicator(item.opportunityScore)}</span>
      </div>
      <div class="token-badges">
        ${item.isFocus ? '<span class="badge badge-focus">Focus</span>' : ""}
        ${item.isInPosition ? '<span class="badge badge-position">Open</span>' : ""}
        ${item.isWeak ? '<span class="badge badge-weak">Weak</span>' : ""}
        <span class="badge">${escapeHtml(item.marketRegime || "n/a")}</span>
      </div>
    </article>
  `).join("");
}

function renderHotPool(items) {
  if (!items || !items.length) {
    hotPool.innerHTML = '<p class="empty-state">Pool non disponibile.</p>';
    return;
  }

  hotPool.innerHTML = items
    .slice(0, 18)
    .map((item) => `
      <article class="token-card token-card-mini ${item.isActive ? "token-active" : ""}">
        <div class="token-title-row">
          <strong>${escapeHtml(item.symbol)}</strong>
          <span class="token-rank">#${item.index}</span>
        </div>
        <div class="token-meta-row">
          <span>RSI ${formatIndicator(item.rsi)}</span>
          <span>Opp ${formatIndicator(item.opportunityScore)}</span>
        </div>
        <div class="token-badges">
          ${item.isActive ? '<span class="badge badge-position">Attivo</span>' : ""}
          ${item.isFocus ? '<span class="badge badge-focus">Focus</span>' : ""}
          ${item.isBestCandidate ? '<span class="badge badge-best">Top</span>' : ""}
        </div>
      </article>
    `)
    .join("");
}

function renderSwapTimeline(swaps) {
  if (!swaps || !swaps.length) {
    swapTimeline.innerHTML = '<p class="empty-state">Nessuno swap registrato.</p>';
    return;
  }

  swapTimeline.innerHTML = swaps.slice(0, 8).map((swap) => `
    <article class="timeline-item">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <div class="timeline-title-row">
          <strong>${escapeHtml(swap.dropped)} -> ${escapeHtml(swap.added)}</strong>
          <span>${formatRelativeTime(swap.time)}</span>
        </div>
        <p>RSI debole rilevato: ${swap.weakRsi === null ? "n/a" : formatIndicator(swap.weakRsi)}</p>
      </div>
    </article>
  `).join("");
}

function renderWatchlistSidebar(statusData) {
  const watchlist = statusData.watchlist || {};
  const runtime = statusData.runtime || {};
  renderFacts(watchlistOverview, [
    ["Watchlist attiva", String((watchlist.active || []).length)],
    ["Pool calda", String((watchlist.hotPool || []).length)],
    ["Focus", statusData.decision.symbol || "n/a"],
    ["Ultimo pool refresh", formatRelativeTime(watchlist.lastPoolRefreshAt)],
    ["Ultima rotazione", formatRelativeTime(watchlist.lastRotationAt)],
    ["Soglia RSI debole", formatIndicator(watchlist.weakThresholdRsi)],
    ["Cadence weak swap", formatDurationMs(watchlist.rotationCadenceMs)],
    ["WS attivi", String((runtime.realtimeSymbols || []).length)],
    ["Mercati REST", String(runtime.restSymbolCount ?? 0)]
  ]);
  renderActiveWatchlist(watchlist.active || []);
  renderHotPool(watchlist.hotPool || []);
  renderSwapTimeline(watchlist.recentSwaps || []);
}

function renderRuntimePanel(statusData) {
  renderFacts(runtimeFacts, [
    ["Ultimo aggiornamento bot", formatRelativeTime(statusData.bot.lastUpdate)],
    ["Ultimo ciclo completato", formatRelativeTime(statusData.runtime?.lastCompletedCycleAt)],
    ["Durata ultimo ciclo", formatDurationMs(statusData.runtime?.lastCycleDurationMs)],
    ["Scan cycle", String(statusData.runtime?.scanCycle ?? 0)],
    ["Strategia", escapeHtml(statusData.bot.strategy || "n/a")],
    ["Profilo esecuzione", statusData.overview?.aggressiveModeEnabled ? "Aggressivo" : "Normale"],
    ["Best candidate", escapeHtml(statusData.overview?.bestCandidateSymbol || "n/a")],
    ["Filtro BTC", statusData.overview?.btcFilterEnabled ? "Attivo" : "Disattivo"],
    ["Paper trading", statusData.overview?.paperTrading ? "Attivo" : "Disattivo"]
  ]);
}

function renderPerformancePanel(statusData) {
  const stats = statusData.stats || {};
  renderFacts(performanceFacts, [
    ["Trade chiusi", String(stats.totalClosedRounds ?? 0)],
    ["Win rate", `${formatIndicator(stats.winRatePct)}%`],
    ["Profit factor", formatIndicator(stats.profitFactor)],
    ["Expectancy", formatSignedUsdt(stats.expectancyUsdt)],
    ["Avg winner", formatSignedUsdt(stats.avgWinnerUsdt)],
    ["Avg loser", formatSignedUsdt(stats.avgLoserUsdt)],
    ["Max drawdown", `${formatSignedUsdt(-Math.abs(stats.maxDrawdownUsdt || 0))} (${formatIndicator(stats.maxDrawdownPct)}%)`, getValueClass(-Math.abs(stats.maxDrawdownUsdt || 0))],
    ["Fees pagate", formatUsdt(stats.totalFeesPaid)],
    ["Slippage pagata", formatUsdt(stats.totalSlippagePaid)],
    ["Turnover", formatUsdt(stats.turnoverUsdt)],
    ["Avg hold", `${formatIndicator(stats.averageHoldMinutes)} min`]
  ]);

  const engineBreakdown = Array.isArray(stats.engineBreakdown) ? stats.engineBreakdown : [];
  if (!engineBreakdown.length) {
    engineBreakdownBody.innerHTML = '<tr><td colspan="5">Nessun dato performance disponibile.</td></tr>';
    return;
  }

  engineBreakdownBody.innerHTML = engineBreakdown
    .sort((left, right) => right.grossPnlUsdt - left.grossPnlUsdt)
    .map((entry) => `
      <tr>
        <td>${escapeHtml(entry.engine)}</td>
        <td>${entry.count}</td>
        <td>${formatIndicator(entry.winRatePct)}%</td>
        <td class="${getValueClass(entry.grossPnlUsdt)}">${formatSignedUsdt(entry.grossPnlUsdt)}</td>
        <td class="${getValueClass(entry.avgPnlUsdt)}">${formatSignedUsdt(entry.avgPnlUsdt)}</td>
      </tr>
    `)
    .join("");
}

function renderResearchModeSelector(modes) {
  if (!researchModeChips) return;
  if (!modes.length) {
    researchModeChips.innerHTML = "";
    return;
  }

  researchModeChips.innerHTML = modes.map((mode) => `
    <button
      type="button"
      class="chip-button ${clientState.selectedResearchMode === mode.strategyMode ? "chip-active" : ""}"
      data-research-mode="${escapeHtml(mode.strategyMode)}"
    >
      ${escapeHtml(mode.strategyMode)}
    </button>
  `).join("");
}

function renderSimulatedRounds(modeReport) {
  if (!simulatedRoundsBody) return;
  const rounds = Array.isArray(modeReport?.rounds) ? modeReport.rounds : [];
  if (!rounds.length) {
    simulatedRoundsBody.innerHTML = '<tr><td colspan="6">Nessun round simulato disponibile per questa modalita.</td></tr>';
    return;
  }

  simulatedRoundsBody.innerHTML = rounds.slice(0, 18).map((round) => {
    const pnlClass = getValueClass(round.realizedPnl);
    const events = Array.isArray(round.events) ? round.events : [];
    const eventLines = events.map((event) => `
      <li>
        <strong>${escapeHtml(event.action)}</strong>
        <span>${escapeHtml(formatDate(event.time))}</span>
        <span> @ ${escapeHtml(formatPrice(event.price))}</span>
        ${event.reason ? `<span> | ${escapeHtml(event.reason)}</span>` : ""}
      </li>
    `).join("");

    return `
      <tr>
        <td>${escapeHtml(formatDate(round.startTime))}</td>
        <td><strong>${escapeHtml(round.symbol)}</strong></td>
        <td>${escapeHtml(round.entryEngine || "n/a")}</td>
        <td>${round.durationMinutes ? `${formatIndicator(round.durationMinutes)} m` : "n/a"}</td>
        <td class="${pnlClass}">${formatSignedUsdt(round.realizedPnl)}</td>
        <td>
          <details class="trade-info">
            <summary class="info-chip" title="Dettagli simulazione">i</summary>
            <div class="trade-tooltip">
              <strong>${escapeHtml(round.symbol)} | ${escapeHtml(round.entryEngine || "n/a")}</strong>
              <p>Ingresso medio: ${escapeHtml(formatPrice(round.weightedEntryPrice))}</p>
              <p>Uscita: ${escapeHtml(formatPrice(round.exitPrice))}</p>
              <p>Fee: ${escapeHtml(formatUsdt(round.totalFees))} | Slippage: ${escapeHtml(formatUsdt(round.totalSlippage))}</p>
              <p>Motivo ingresso: ${escapeHtml(round.entryReason || "n/a")}</p>
              <p>Motivo finale: ${escapeHtml(round.lastReason || "n/a")}</p>
              <ul class="explanation-list">${eventLines || "<li>Nessun evento registrato.</li>"}</ul>
            </div>
          </details>
        </td>
      </tr>
    `;
  }).join("");
}

function renderBacktestLog(job) {
  if (!backtestLog) return;
  const logs = Array.isArray(job?.logs) ? [...job.logs].slice(-8).reverse() : [];
  if (!logs.length) {
    backtestLog.innerHTML = '<p class="empty-state">Nessun log di ricerca disponibile.</p>';
    return;
  }

  backtestLog.innerHTML = logs.map((entry) => `
    <article class="timeline-item">
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <div class="timeline-title-row">
          <strong>${escapeHtml(formatDate(entry.time))}</strong>
        </div>
        <p class="log-line">${escapeHtml(entry.message)}</p>
      </div>
    </article>
  `).join("");
}

function renderResearchPanel(statusData) {
  const report = statusData.research?.backtestReport || null;
  const job = statusData.research?.backtestJob || null;
  const jobStatus = job?.active
    ? `Ricerca in corso: ${job.stage || "running"} (${job.progressPct ?? 0}%)${job.symbol ? ` | ${job.symbol}` : ""}`
    : job?.stage === "failed"
      ? `Ricerca fallita: ${job.error || "errore sconosciuto"}`
      : job?.stage === "completed"
        ? `Ultima ricerca completata ${formatRelativeTime(job.finishedAt)}`
        : "La ricerca strategica puo essere avviata direttamente da qui.";

  if (backtestRunStatus) {
    backtestRunStatus.textContent = jobStatus;
  }
  if (runBacktestButton) {
    runBacktestButton.disabled = Boolean(job?.active);
    runBacktestButton.textContent = job?.active ? "Ricerca in corso..." : "Esegui ricerca";
  }

  if (!report) {
    renderFacts(researchSummary, [
    ["Stato", job?.stage || "idle"],
    ["Azione", "Avvia la ricerca dal pannello"],
    ["Profilo", clientState.backtestForm.aggressiveMode ? "Aggressivo" : "Normale"],
    ["Timeline", "n/a"],
    ["Simboli", "0"]
  ]);
    strategyModesBody.innerHTML = '<tr><td colspan="6">Nessun report di backtest disponibile.</td></tr>';
    researchSymbolsBody.innerHTML = '<tr><td colspan="4">Esegui una ricerca per vedere i simboli migliori.</td></tr>';
    renderResearchModeSelector([]);
    renderSimulatedRounds(null);
    renderBacktestLog(job);
    return;
  }

  const recommendedMode = report.recommendedMode || "n/a";
  const reportModes = Array.isArray(report.modes) ? report.modes : [];
  if (!clientState.selectedResearchMode || !reportModes.some((mode) => mode.strategyMode === clientState.selectedResearchMode)) {
    clientState.selectedResearchMode = recommendedMode !== "n/a" ? recommendedMode : (reportModes[0]?.strategyMode || null);
  }
  const selectedMode = reportModes.find((mode) => mode.strategyMode === clientState.selectedResearchMode) || reportModes[0] || null;
  const topSymbols = Array.isArray(selectedMode?.symbolBreakdown) ? selectedMode.symbolBreakdown : [];

  renderFacts(researchSummary, [
    ["Modalita raccomandata", escapeHtml(recommendedMode)],
    ["Generato", formatRelativeTime(report.generatedAt)],
    ["Stato job", escapeHtml(job?.stage || "idle")],
    ["Profilo", escapeHtml(report.strategyProfile || (report.request?.aggressiveMode ? "aggressive" : "normal"))],
    ["Timeline", report.timeline?.start && report.timeline?.end ? `${formatDate(report.timeline.start)} -> ${formatDate(report.timeline.end)}` : "n/a"],
    ["Simboli", String(report.symbolCount ?? (report.symbols || []).length ?? 0)],
    ["Campioni 5m", String(report.timeline?.points ?? 0)],
    ["Heuristic score", formatIndicator(report.heuristics?.recommendedModeScore)],
    ["Origine", escapeHtml(report.request?.resolvedSource || "n/a")],
    ["Modalita selezionata", escapeHtml(selectedMode?.strategyMode || "n/a")]
  ]);

  strategyModesBody.innerHTML = reportModes.length
    ? reportModes.map((mode) => `
        <tr>
          <td>
            <div class="symbol-cell">
              <strong>${escapeHtml(mode.strategyMode)}</strong>
              ${mode.strategyMode === recommendedMode ? '<span class="badge badge-best">Raccomandata</span>' : ""}
            </div>
          </td>
          <td class="${getValueClass(mode.summary?.sessionPnl)}">${formatSignedUsdt(mode.summary?.sessionPnl)}</td>
          <td>${formatIndicator(mode.stats?.winRatePct)}%</td>
          <td>${formatIndicator(mode.stats?.profitFactor)}</td>
          <td class="${getValueClass(-Math.abs(mode.stats?.maxDrawdownUsdt || 0))}">${formatIndicator(mode.stats?.maxDrawdownPct)}%</td>
          <td>${formatIndicator(mode.recommendationScore)}</td>
        </tr>
      `).join("")
    : '<tr><td colspan="6">Nessuna modalita valutata.</td></tr>';

  renderResearchModeSelector(reportModes);
  renderSimulatedRounds(selectedMode);

  researchSymbolsBody.innerHTML = topSymbols.length
    ? topSymbols.slice(0, 8).map((entry) => `
        <tr>
        <td>${escapeHtml(entry.symbol)}</td>
        <td>${entry.closedRounds}</td>
        <td class="${getValueClass(entry.grossPnlUsdt)}">${formatSignedUsdt(entry.grossPnlUsdt)}</td>
        <td>${formatIndicator(entry.winRatePct)}%</td>
      </tr>
    `).join("")
    : '<tr><td colspan="4">Nessun round chiuso nella modalita selezionata.</td></tr>';

  renderBacktestLog(job);
}

function renderDecision(statusData) {
  currentActionElement.textContent = statusData.decision.action || "HOLD";
  currentActionElement.className = `big-action ${getActionClass(statusData.decision.action)}`;
  currentSymbolBadge.textContent = statusData.decision.symbol || "n/a";

  renderFacts(decisionMainFacts, [
    ["Mercato in focus", escapeHtml(statusData.decision.symbol || "n/a")],
    ["Perche guardiamo questo mercato", escapeHtml(statusData.decision.focusReason || "n/a")],
    ["Motivo principale", escapeHtml(statusData.decision.reason || "n/a")],
    ["Decision state", escapeHtml(statusData.decision.decisionState || "n/a")],
    ["Profilo strategia", escapeHtml(statusData.decision.strategyProfile || "n/a")],
    ["Entry engine", escapeHtml(statusData.decision.entryEngine || "n/a")],
    ["Regime", escapeHtml(statusData.decision.marketRegime || "n/a")],
    ["Focus score", formatIndicator(statusData.decision.focusScore)],
    ["Opportunity score", formatIndicator(statusData.decision.opportunityScore)],
    ["Setup quality", formatIndicator(statusData.decision.setupQualityScore)],
    ["Entrate aperte", String(statusData.portfolio.entryCount ?? 0)],
    ["Saldo USDT disponibile", formatUsdt(statusData.portfolio.usdtBalance)],
    ["Capitale impegnato", formatUsdt(statusData.portfolio.budgetUsed)],
    ["Spazio residuo", formatUsdt(statusData.portfolio.budgetRemaining)],
    ["RSI", formatIndicator(statusData.decision.rsi)],
    ["EMA veloce", formatPrice(statusData.decision.ema9)],
    ["EMA lenta", formatPrice(statusData.decision.ema21)],
    ["Edge netta attesa", formatBps(statusData.decision.projectedNetEdgeBps)],
    ["R/R atteso", formatIndicator(statusData.decision.projectedRiskRewardRatio)],
    ["Profitto netto atteso", formatUsdt(statusData.decision.expectedNetProfitUsdt)],
    ["Stop pianificato", formatPrice(statusData.decision.plannedStopLoss)],
    ["Target pianificato", formatPrice(statusData.decision.plannedTakeProfit)]
  ]);

  shortExplanationElement.textContent = statusData.decision.shortExplanation || "Spiegazione non disponibile.";
  detailedExplanationElement.textContent = statusData.decision.detailedExplanation || "";
  renderReasonList(statusData.decision.reasonList || []);
}

function renderDashboard(statusData, tradesData) {
  clientState.lastPayload = { statusData, tradesData };
  clientState.lastRefreshAt = new Date().toISOString();
  clientState.refreshError = null;
  btcFilterToggle.checked = Boolean(statusData.overview?.btcFilterEnabled);
  aggressiveModeToggle.checked = Boolean(statusData.overview?.aggressiveModeEnabled);
  if (backtestAggressiveToggle && backtestAggressiveToggle.dataset.dirty !== "true") {
    clientState.backtestForm.aggressiveMode = Boolean(statusData.overview?.aggressiveModeEnabled);
    backtestAggressiveToggle.checked = clientState.backtestForm.aggressiveMode;
  }
  summaryElement.textContent = statusData.bot.summary;
  renderMarketFilters();
  renderHeroStatus(statusData);

  renderSummaryCards([
    { label: "Bot", value: statusData.overview.botActive ? "Attivo" : "Fermo", note: statusData.bot.exchange || "n/a" },
    { label: "Paper trading", value: statusData.overview.paperTrading ? "Attivo" : "Disattivato", note: statusData.bot.strategy || "n/a" },
    { label: "Saldo USDT", value: formatUsdt(statusData.portfolio.usdtBalance), note: "Liquidita libera" },
    { label: "Valore totale", value: formatUsdt(statusData.overview.portfolioValue), note: "Saldo + posizioni" },
    { label: "PnL sessione", value: formatSignedUsdt(statusData.overview.sessionPnl), cssClass: getValueClass(statusData.overview.sessionPnl), note: `${formatIndicator(statusData.portfolio.sessionPnlPercent)}%` },
    { label: "Posizioni aperte", value: String(statusData.overview.activeCount || 0), note: `${(statusData.runtime?.realtimeSymbols || []).length} WS live` }
  ]);

  renderDecision(statusData);
  renderPositions(statusData.overview.positions || []);
  renderMarkets((statusData.watchlist?.active || []).map((activeItem) => {
    const market = (statusData.markets || []).find((entry) => entry.symbol === activeItem.symbol) || {};
    return { ...market, ...activeItem };
  }));
  renderWatchlistSidebar(statusData);
  renderRuntimePanel(statusData);
  renderPerformancePanel(statusData);
  renderResearchPanel(statusData);
  renderTrades(Array.isArray(tradesData.trades) ? tradesData.trades : []);
  refreshStatus.textContent = `Ultimo refresh ${formatRelativeTime(clientState.lastRefreshAt)}`;
}

async function fetchDashboardData() {
  const [statusResponse, tradesResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/trades")
  ]);

  if (!statusResponse.ok || !tradesResponse.ok) {
    throw new Error("Dashboard API unavailable.");
  }

  return {
    statusData: await statusResponse.json(),
    tradesData: await tradesResponse.json()
  };
}

async function loadDashboard() {
  if (clientState.isRefreshing) {
    return;
  }

  clientState.isRefreshing = true;
  refreshButton.disabled = true;
  refreshStatus.textContent = "Aggiornamento in corso...";

  try {
    const { statusData, tradesData } = await fetchDashboardData();
    renderDashboard(statusData, tradesData);
  } catch (error) {
    clientState.refreshError = error.message;
    refreshStatus.textContent = "Aggiornamento non disponibile.";
    throw error;
  } finally {
    clientState.isRefreshing = false;
    refreshButton.disabled = false;
  }
}

async function resetSession() {
  const confirmed = window.confirm("Vuoi davvero azzerare la sessione di paper trading?");
  if (!confirmed) return;

  const response = await fetch("/api/reset", { method: "POST" });
  if (!response.ok) {
    resetResult.textContent = "Reset non riuscito.";
    return;
  }

  resetResult.textContent = "Sessione azzerata con successo.";
  await loadDashboard();
}

async function updateBtcFilter() {
  const nextValue = !btcFilterToggle.checked;
  btcFilterToggle.disabled = true;

  try {
    const response = await fetch("/api/btc-filter", {
      body: JSON.stringify({ enabled: nextValue }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "BTC filter update failed.");
    }
    btcFilterToggle.checked = Boolean(data.btcFilterEnabled);
  } finally {
    btcFilterToggle.disabled = false;
  }
}

async function updateAggressiveMode() {
  const nextValue = !aggressiveModeToggle.checked;
  aggressiveModeToggle.disabled = true;

  try {
    const response = await fetch("/api/aggressive-mode", {
      body: JSON.stringify({ enabled: nextValue }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "Aggressive mode update failed.");
    }
    aggressiveModeToggle.checked = Boolean(data.aggressiveModeEnabled);
    resetResult.textContent = data.aggressiveModeEnabled
      ? "Modalita aggressiva attivata."
      : "Modalita aggressiva disattivata.";
    await loadDashboard();
  } finally {
    aggressiveModeToggle.disabled = false;
  }
}

async function runBacktest() {
  const payload = {
    aggressiveMode: Boolean(backtestAggressiveToggle.checked),
    days: Number(backtestDaysInput.value || clientState.backtestForm.days || 3),
    symbolLimit: Number(backtestSymbolLimitInput.value || clientState.backtestForm.symbolLimit || 6),
    symbols: String(backtestSymbolsInput.value || "").trim(),
    useActiveWatchlist: Boolean(backtestUseWatchlistToggle.checked)
  };

  const response = await fetch("/api/backtest/run", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const data = await response.json();
  if (!response.ok && data.reason !== "already_running") {
    throw new Error(data.message || data.error || "Backtest non avviato.");
  }

  backtestRunStatus.textContent = data.reason === "already_running"
    ? "Una ricerca e gia in corso."
    : "Ricerca avviata. La dashboard mostrera l'avanzamento.";
  await loadDashboard();
}

function attachEventListeners() {
  resetButton.addEventListener("click", () => {
    resetSession().catch(() => {
      resetResult.textContent = "Errore durante il reset.";
    });
  });

  btcFilterToggle.addEventListener("click", (event) => {
    event.preventDefault();
    updateBtcFilter().catch(() => {
      resetResult.textContent = "Errore durante l'aggiornamento del Filtro BTC.";
    });
  });

  aggressiveModeToggle.addEventListener("click", (event) => {
    event.preventDefault();
    updateAggressiveMode().catch(() => {
      resetResult.textContent = "Errore durante l'aggiornamento della modalita aggressiva.";
    });
  });

  refreshButton.addEventListener("click", () => {
    loadDashboard().catch(() => {
      summaryElement.textContent = "Impossibile aggiornare la dashboard.";
      shortExplanationElement.textContent = "Aggiornamento temporaneamente non disponibile.";
    });
  });

  runBacktestButton.addEventListener("click", () => {
    runBacktest().catch((error) => {
      backtestRunStatus.textContent = error.message || "Errore durante l'avvio della ricerca.";
    });
  });

  marketSearch.addEventListener("input", (event) => {
    clientState.searchQuery = event.target.value.trim().toLowerCase();
    if (clientState.lastPayload) {
      renderDashboard(clientState.lastPayload.statusData, clientState.lastPayload.tradesData);
    }
  });

  marketFilterChips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-id]");
    if (!button) return;
    clientState.activeFilter = button.dataset.filterId || "all";
    if (clientState.lastPayload) {
      renderDashboard(clientState.lastPayload.statusData, clientState.lastPayload.tradesData);
    }
  });

  researchModeChips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-research-mode]");
    if (!button) return;
    clientState.selectedResearchMode = button.dataset.researchMode || null;
    if (clientState.lastPayload) {
      renderDashboard(clientState.lastPayload.statusData, clientState.lastPayload.tradesData);
    }
  });

  backtestDaysInput.addEventListener("input", () => {
    clientState.backtestForm.days = Number(backtestDaysInput.value || 3);
  });
  backtestSymbolLimitInput.addEventListener("input", () => {
    clientState.backtestForm.symbolLimit = Number(backtestSymbolLimitInput.value || 6);
  });
  backtestSymbolsInput.addEventListener("input", () => {
    clientState.backtestForm.symbols = backtestSymbolsInput.value;
  });
  backtestUseWatchlistToggle.addEventListener("change", () => {
    clientState.backtestForm.useActiveWatchlist = Boolean(backtestUseWatchlistToggle.checked);
  });
  backtestAggressiveToggle.addEventListener("change", () => {
    clientState.backtestForm.aggressiveMode = Boolean(backtestAggressiveToggle.checked);
    backtestAggressiveToggle.dataset.dirty = "true";
  });
}

renderMarketFilters();
backtestDaysInput.value = String(clientState.backtestForm.days);
backtestSymbolLimitInput.value = String(clientState.backtestForm.symbolLimit);
backtestSymbolsInput.value = clientState.backtestForm.symbols;
backtestUseWatchlistToggle.checked = clientState.backtestForm.useActiveWatchlist;
backtestAggressiveToggle.checked = clientState.backtestForm.aggressiveMode;
attachEventListeners();

loadDashboard().catch(() => {
  summaryElement.textContent = "Impossibile caricare la dashboard.";
  shortExplanationElement.textContent = "La dashboard non riesce a leggere i dati del bot.";
});

setInterval(() => {
  loadDashboard().catch(() => {
    summaryElement.textContent = "Impossibile aggiornare la dashboard.";
    shortExplanationElement.textContent = "Aggiornamento temporaneamente non disponibile.";
  });
}, 4000);
