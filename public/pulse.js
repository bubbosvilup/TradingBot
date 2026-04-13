// Module responsibility: render the server-projected Pulse UI contract.

(function registerPulse(globalScope) {
  const refs = {
    botCards: document.getElementById("bot-cards"),
    chart: document.getElementById("focus-chart"),
    chartLegend: document.getElementById("chart-legend"),
    focusArchitect: document.getElementById("focus-architect"),
    focusEvents: document.getElementById("focus-events"),
    focusSymbolNote: document.getElementById("focus-symbol-note"),
    focusTitle: document.getElementById("focus-title"),
    historyButton: document.getElementById("history-button"),
    historyClose: document.getElementById("history-close"),
    historyDialog: document.getElementById("history-dialog"),
    historyList: document.getElementById("history-list"),
    historyTitle: document.getElementById("history-title"),
    positionDetails: document.getElementById("position-details"),
    refreshStatus: document.getElementById("refresh-status"),
    resumeButton: document.getElementById("resume-button"),
    statusBots: document.getElementById("status-bots"),
    statusExecution: document.getElementById("status-execution"),
    statusFeed: document.getElementById("status-feed"),
    statusKill: document.getElementById("status-kill"),
    statusKillShell: document.getElementById("status-kill-shell"),
    statusPnl: document.getElementById("status-pnl"),
    statusPositions: document.getElementById("status-positions"),
    statusStream: document.getElementById("status-stream"),
    statusTickAge: document.getElementById("status-tick-age")
  };

  const state = {
    chartAdapter: null,
    chartPayload: null,
    events: [],
    pulse: null,
    pulsePollingInterval: null,
    pulseStream: null,
    chartPollingInterval: null,
    focusDataBotId: null,
    selectedBotId: null
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatMoney(value) {
    const amount = asNumber(value, 0);
    const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
    return `${sign}$${Math.abs(amount).toFixed(2)}`;
  }

  function formatPrice(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "n/a";
    return number >= 100 ? number.toFixed(2) : number.toFixed(4);
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(asNumber(ms, 0) / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  function valueClass(value) {
    const number = asNumber(value, 0);
    if (number > 0) return "value-good";
    if (number < 0) return "value-bad";
    return "";
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Request failed: ${response.status}`);
    }
    return payload;
  }

  function selectedCard() {
    const cards = state.pulse?.botCards || [];
    return cards.find((bot) => bot.botId === state.selectedBotId)
      || cards.find((bot) => bot.position?.state !== "flat")
      || cards[0]
      || null;
  }

  function selectedFocus() {
    const focus = state.pulse?.focusPanel || null;
    return focus?.botId === state.selectedBotId || !state.selectedBotId ? focus : null;
  }

  function ensureSelectedBot() {
    const cards = state.pulse?.botCards || [];
    if (state.selectedBotId && cards.some((bot) => bot.botId === state.selectedBotId)) return;
    state.selectedBotId = state.pulse?.focusPanel?.botId || selectedCard()?.botId || null;
  }

  function renderStatusBar() {
    const status = state.pulse?.statusBar || {};
    const killSwitch = status.killSwitch || {};
    const killActive = killSwitch.severity === "critical";

    refs.statusFeed.textContent = status.feedMode || "n/a";
    refs.statusExecution.textContent = status.executionMode || "PAPER";
    refs.statusBots.textContent = `${status.bots?.running ?? 0}/${status.bots?.total ?? 0}`;
    refs.statusPositions.textContent = String(status.openPositions ?? 0);
    refs.statusPnl.textContent = formatMoney(status.netPnlUsdt);
    refs.statusPnl.className = valueClass(status.netPnlUsdt);
    refs.statusKill.textContent = killSwitch.state === "triggered" ? "ACTIVE" : killSwitch.state || "inactive";
    refs.statusKill.title = killSwitch.reason || "";
    refs.statusKillShell.classList.toggle("is-active", killActive);
    refs.statusStream.textContent = status.marketStream?.status || "unknown";
    refs.statusTickAge.textContent = Number.isFinite(Number(status.lastTickAgeMs)) ? `${formatDuration(status.lastTickAgeMs)} ago` : "n/a";
  }

  function renderBotCards() {
    ensureSelectedBot();
    const cards = state.pulse?.botCards || [];
    if (!cards.length) {
      refs.botCards.innerHTML = '<p class="empty">No bots configured.</p>';
      return;
    }

    refs.botCards.innerHTML = cards.map((bot) => {
      const selected = bot.botId === state.selectedBotId;
      const pnlClass = valueClass(bot.position?.pnlUsdt);
      const alert = bot.alert;
      return `
        <article class="bot-card ${selected ? "is-selected" : ""}" data-bot-id="${escapeHtml(bot.botId)}" tabindex="0">
          <header>
            <h2>${escapeHtml(bot.symbol || "n/a")}</h2>
            <strong class="${pnlClass}">${escapeHtml(bot.position?.label || "FLAT")}</strong>
          </header>
          <div class="bot-line"><span>${escapeHtml(bot.regime || "warming_up")} . ${escapeHtml(bot.syncStatus || "warming_up")}</span></div>
          <div class="bot-line"><span>${escapeHtml(bot.strategy || "n/a")}</span></div>
          ${alert ? `<div class="bot-alert" title="${escapeHtml(alert.type)}">${escapeHtml(alert.message || alert.type)}</div>` : ""}
        </article>
      `;
    }).join("");
  }

  function renderPositionDetails() {
    const position = state.chartPayload?.position || null;
    const latestPrice = state.chartPayload?.lastPrice ?? position?.currentPrice ?? null;
    const details = position
      ? [
        ["Entry", formatPrice(position.entryPrice)],
        ["Current", formatPrice(latestPrice)],
        ["Unrealized PnL", formatMoney(selectedCard()?.position?.pnlUsdt)],
        ["Hold time", formatDuration(Date.now() - asNumber(position.openedAt, Date.now()))]
      ]
      : [
        ["State", "FLAT"],
        ["Current", formatPrice(latestPrice)],
        ["Unrealized PnL", "$0.00"],
        ["Hold time", "n/a"]
      ];

    refs.positionDetails.innerHTML = details.map(([label, value]) => `
      <article class="detail-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </article>
    `).join("");
  }

  function renderEvents() {
    if (!state.events.length) {
      refs.focusEvents.innerHTML = '<p class="empty">No recent bot events.</p>';
      return;
    }
    refs.focusEvents.innerHTML = state.events.map((event) => `
      <article class="event-item">
        <strong>${escapeHtml(event.level || "INFO")} . ${escapeHtml(formatDuration(Date.now() - asNumber(event.time || event.timestamp, Date.now())))} ago</strong>
        <p>${escapeHtml(event.message || event.type || "event")}</p>
      </article>
    `).join("");
  }

  function renderChart() {
    if (!state.chartAdapter && refs.chart && globalScope.ChartAdapter) {
      state.chartAdapter = globalScope.ChartAdapter.create({
        container: refs.chart,
        legendNode: refs.chartLegend,
        titleNode: null
      });
    }
    if (!state.chartAdapter || !state.chartPayload) return;
    state.chartAdapter.update({
      candles: {},
      lastPrice: state.chartPayload.lastPrice,
      lineData: Array.isArray(state.chartPayload.lineData) ? state.chartPayload.lineData : [],
      markers: [],
      position: state.chartPayload.position,
      symbol: state.chartPayload.symbol
    });
  }

  function renderFocusPanel() {
    const focus = selectedFocus();
    if (!focus) {
      refs.focusTitle.textContent = "No bot selected";
      refs.focusSymbolNote.textContent = "Select a bot";
      refs.focusArchitect.textContent = "warming up...";
      refs.positionDetails.innerHTML = "";
      refs.focusEvents.innerHTML = "";
      refs.resumeButton.classList.add("is-hidden");
      return;
    }

    refs.focusTitle.textContent = focus.symbol || focus.botId || "Bot";
    refs.focusSymbolNote.textContent = focus.botId || "selected bot";
    refs.focusArchitect.textContent = focus.architect?.line || "warming up...";
    renderPositionDetails();
    renderEvents();

    const resume = focus.actions?.resume || {};
    const history = focus.actions?.history || {};
    refs.resumeButton.classList.toggle("is-hidden", !resume.visible);
    refs.resumeButton.disabled = !resume.enabled;
    refs.resumeButton.title = resume.reason || "";
    refs.resumeButton.dataset.botId = focus.botId || "";
    refs.historyButton.classList.toggle("is-hidden", history.visible === false);
    refs.historyButton.disabled = !history.enabled;
    refs.historyButton.title = history.reason || "";
    refs.historyButton.dataset.botId = focus.botId || "";
    renderChart();
  }

  function render() {
    renderStatusBar();
    renderBotCards();
    renderFocusPanel();
    refs.refreshStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  function applyPulse(payload) {
    if (!payload) return;
    const previousFocusBotId = state.focusDataBotId;
    const previousFocusPanel = state.pulse?.focusPanel || null;
    if (state.selectedBotId && payload.focusPanel?.botId !== state.selectedBotId && previousFocusPanel?.botId === state.selectedBotId) {
      payload.focusPanel = previousFocusPanel;
    }
    state.pulse = payload;
    ensureSelectedBot();
    render();

    const focus = selectedFocus();
    if (focus?.botId && focus.botId !== previousFocusBotId) {
      safeRefresh("focus", refreshFocusData);
    }
  }

  async function refreshPulse() {
    const query = state.selectedBotId ? `?botId=${encodeURIComponent(state.selectedBotId)}` : "";
    applyPulse(await fetchJson(`/api/pulse${query}`));
  }

  async function loadChart() {
    const focus = selectedFocus();
    if (!focus?.symbol) return;
    state.chartPayload = await fetchJson(`/api/chart?symbol=${encodeURIComponent(focus.symbol)}`);
  }

  async function loadEvents() {
    const focus = selectedFocus();
    const events = focus?.botId
      ? await fetchJson(`/api/events?botId=${encodeURIComponent(focus.botId)}&limit=5`)
      : [];
    state.events = Array.isArray(events) ? events : [];
  }

  async function refreshChart() {
    await loadChart();
    renderFocusPanel();
  }

  async function refreshFocusData() {
    const focus = selectedFocus();
    state.focusDataBotId = focus?.botId || null;
    await Promise.all([loadChart(), loadEvents()]);
    renderFocusPanel();
  }

  async function safeRefresh(label, fn) {
    try {
      await fn();
    } catch (error) {
      refs.refreshStatus.textContent = `${label} failed: ${error?.message || error}`;
    }
  }

  async function openHistory(botId) {
    const query = botId ? `?botId=${encodeURIComponent(botId)}&limit=20` : "?limit=20";
    const trades = await fetchJson(`/api/trades${query}`);
    const filtered = Array.isArray(trades) ? trades : [];
    refs.historyTitle.textContent = botId ? `Closed positions . ${botId}` : "Closed positions";
    refs.historyList.innerHTML = filtered.length
      ? filtered.map((trade) => `
        <article class="history-item">
          <strong>${escapeHtml(trade.symbol)} . ${escapeHtml(String(trade.side || "").toUpperCase())} . ${escapeHtml(formatMoney(trade.netPnl))}</strong>
          <p>${escapeHtml(String((trade.exitReason || [])[0] || trade.result || "closed").replace(/_/g, " "))}</p>
        </article>
      `).join("")
      : '<p class="empty">No closed positions for this bot.</p>';
    if (typeof refs.historyDialog.showModal === "function") {
      refs.historyDialog.showModal();
    } else {
      refs.historyDialog.setAttribute("open", "open");
    }
  }

  refs.botCards.addEventListener("click", async (event) => {
    const card = event.target.closest("[data-bot-id]");
    if (!card) return;
    state.selectedBotId = card.getAttribute("data-bot-id");
    state.focusDataBotId = null;
    await safeRefresh("pulse", refreshPulse);
  });

  refs.resumeButton.addEventListener("click", async () => {
    const botId = refs.resumeButton.dataset.botId;
    if (!botId) return;
    await safeRefresh("resume", async () => {
      await fetchJson(`/api/bots/${encodeURIComponent(botId)}/resume`, { method: "POST" });
      state.focusDataBotId = null;
      await refreshPulse();
    });
  });

  refs.historyButton.addEventListener("click", () => {
    safeRefresh("history", () => openHistory(refs.historyButton.dataset.botId));
  });

  refs.historyClose.addEventListener("click", () => {
    refs.historyDialog.close?.();
    refs.historyDialog.removeAttribute("open");
  });

  function fallbackToPolling() {
    if (state.pulsePollingInterval) return;
    state.pulsePollingInterval = setInterval(() => safeRefresh("pulse", refreshPulse), 2000);
    safeRefresh("pulse", refreshPulse);
  }

  function startPulseStream() {
    if (!globalScope.EventSource) {
      fallbackToPolling();
      return;
    }

    const es = new EventSource("/api/pulse/stream");
    state.pulseStream = es;
    es.onmessage = (event) => {
      try {
        applyPulse(JSON.parse(event.data));
      } catch (error) {
        refs.refreshStatus.textContent = `pulse stream parse failed: ${error?.message || error}`;
      }
    };
    es.onerror = () => {
      es.close();
      fallbackToPolling();
    };
  }

  startPulseStream();
  state.chartPollingInterval = setInterval(() => safeRefresh("chart", refreshChart), 2000);
})(window);
