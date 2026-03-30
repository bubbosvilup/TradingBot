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

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }

  return Number(value).toFixed(2);
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

function formatSignedUsdt(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "n/a";
  }

  const number = Number(value);
  return `${number > 0 ? "+" : ""}${formatUsdt(number)}`;
}

function getValueClass(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const number = Number(value);
  if (number > 0) {
    return "value-positive";
  }

  if (number < 0) {
    return "value-negative";
  }

  return "";
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
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
    .map(([label, value, cssClass]) => `<div class="fact"><dt>${label}</dt><dd class="${cssClass || ""}">${value}</dd></div>`)
    .join("");
}

function renderSummaryCards(items) {
  summaryCards.innerHTML = items
    .map((item) => {
      return `
        <article class="mini-card">
          <span class="mini-label">${item.label}</span>
          <strong class="mini-value ${item.cssClass || ""}">${item.value}</strong>
        </article>
      `;
    })
    .join("");
}

function renderReasonList(items) {
  if (!items || !items.length) {
    reasonListElement.innerHTML = "<li>Nessun dettaglio disponibile.</li>";
    return;
  }

  reasonListElement.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
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
              <strong>${pos.symbol}</strong>
              <span class="badge ${pos.trailingActive ? "badge-best" : "badge-position"}">
                ${pos.trailingActive ? "Trailing" : "Open"}
              </span>
            </div>
          </td>
          <td>${formatPrice(pos.entryPrice)}</td>
          <td>${formatPrice(pos.lastPrice)}</td>
          <td>${formatBtc(pos.btcAmount)}</td>
          <td class="${pnlClass}">${pos.pnlLabel}</td>
          <td>${formatPrice(stopLoss)}</td>
          <td>${pos.takeProfit ? formatPrice(pos.takeProfit) : "n/a"}</td>
        </tr>
      `;
    })
    .join("");
}

function renderMarkets(markets) {
  if (!markets || !markets.length) {
    marketsBody.innerHTML = '<tr><td colspan="8">Nessun mercato disponibile.</td></tr>';
    return;
  }

  marketsBody.innerHTML = markets
    .map((market) => {
      const badge = market.isInPosition
        ? '<span class="badge badge-position">Posizione aperta</span>'
        : market.isBestCandidate
          ? '<span class="badge badge-best">Migliore opportunita</span>'
          : '<span class="badge badge-wait">In attesa</span>';

      return `
        <tr>
          <td>
            <div class="symbol-cell">
              <span>${market.symbol}</span>
              ${badge}
            </div>
          </td>
          <td>${formatPrice(market.lastPrice)}</td>
          <td>${market.trend}</td>
          <td>${market.signal}</td>
          <td>${market.score === null || market.score === undefined ? "n/a" : market.score}</td>
          <td>${formatIndicator(market.rsi)}</td>
          <td>${formatPrice(market.emaFast)}</td>
          <td>${formatPrice(market.emaSlow)}</td>
        </tr>
      `;
    })
    .join("");
}

function groupTrades(trades) {
  const groups = new Map();
  
  // Group activities by tradeId
  for (const t of trades) {
    const id = t.tradeId || `Legacy-${t.time}-${t.symbol}`;
    if (!groups.has(id)) {
      groups.set(id, []);
    }
    groups.get(id).push(t);
  }

  // Aggregate groups into trade rounds
  const rounds = Array.from(groups.values()).map(events => {
    const sorted = events.sort((a, b) => new Date(a.time) - new Date(b.time));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const isClosed = sorted.some(e => e.action === "SELL_FULL");
    
    // Aggregation of BUYs (Entry)
    const buys = sorted.filter(e => e.action === "BUY");
    const totalBtc = buys.reduce((sum, e) => sum + e.btcAmount, 0);
    const totalUsdt = buys.reduce((sum, e) => sum + (e.usdtAmount || e.price * e.btcAmount), 0);
    const avgEntry = totalUsdt / totalBtc;
    
    // Total PnL sum
    const totalPnl = sorted.reduce((sum, e) => sum + (e.netPnlUsdt || 0), 0);
    
    // Duration
    const startTime = new Date(first.time);
    const endTime = new Date(last.time);
    const durationMs = endTime - startTime;
    const durationMin = Math.floor(durationMs / 60000);
    
    return {
      id: first.tradeId || "Legacy",
      symbol: first.symbol,
      startTime,
      endTime: isClosed ? endTime : null,
      duration: isClosed ? (durationMin > 0 ? `${durationMin}m` : "< 1m") : "In corso...",
      entryPrice: avgEntry,
      exitPrice: isClosed ? last.price : null,
      pnl: totalPnl,
      status: isClosed ? "Chiuso" : "Aperto",
      lastReason: last.reason,
      events: sorted
    };
  });

  return rounds.sort((a, b) => b.startTime - a.startTime);
}

function renderTrades(trades) {
  if (!trades.length) {
    tradesBody.innerHTML = '<tr><td colspan="6">Nessuna operazione completata disponibile.</td></tr>';
    return;
  }

  const rounds = groupTrades(trades);

  tradesBody.innerHTML = rounds
    .map((round) => {
      const pnlClass = getValueClass(round.pnl);
      const lastEvent = round.events[round.events.length - 1];
      const shortExplanation = escapeHtml(lastEvent.explanationShort || lastEvent.reason || "Dettagli non disponibili.");
      
      const statusBadge = round.status === "Chiuso" 
        ? '<span class="badge badge-wait">Chiuso</span>' 
        : '<span class="badge badge-position">In corso</span>';

      const priceOut = round.exitPrice ? formatPrice(round.exitPrice) : "---";

      return `
        <tr>
          <td>${formatDate(round.startTime)}</td>
          <td><strong>${round.symbol}</strong></td>
          <td>${statusBadge}</td>
          <td>
            <div class="trade-action-cell">
              <span>${formatPrice(round.entryPrice)} / ${priceOut}</span>
              <details class="trade-info">
                <summary class="info-chip" title="Dettagli operazione">i</summary>
                <div class="trade-tooltip">
                  <strong>Status: ${round.status}</strong>
                  <p>${shortExplanation}</p>
                  <p>Motivo: ${round.lastReason || "Nessuno"}</p>
                  <p>Eventi: ${round.events.length}</p>
                </div>
              </details>
            </div>
          </td>
          <td>${round.duration}</td>
          <td class="${pnlClass}">${round.status === "Chiuso" ? formatSignedUsdt(round.pnl) : "---"}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadDashboard() {
  const [statusResponse, tradesResponse] = await Promise.all([
    fetch("/api/status"),
    fetch("/api/trades")
  ]);

  if (!statusResponse.ok || !tradesResponse.ok) {
    throw new Error("Dashboard API unavailable.");
  }

  const statusData = await statusResponse.json();
  const tradesData = await tradesResponse.json();

  btcFilterToggle.checked = Boolean(statusData.overview?.btcFilterEnabled);

  summaryElement.textContent = statusData.bot.summary;

  renderSummaryCards([
    { label: "Bot", value: statusData.overview.botActive ? "Attivo" : "Fermo" },
    { label: "Paper trading", value: statusData.overview.paperTrading ? "Attivo" : "Disattivato" },
    { label: "Saldo USDT", value: formatUsdt(statusData.portfolio.usdtBalance) },
    { label: "Valore totale", value: formatUsdt(statusData.overview.portfolioValue) },
    {
      label: "PnL sessione",
      value: formatSignedUsdt(statusData.overview.sessionPnl),
      cssClass: getValueClass(statusData.overview.sessionPnl)
    },
    { label: "Posizioni aperte", value: statusData.overview.activeCount || 0 }
  ]);

  currentActionElement.textContent = statusData.decision.action || "HOLD";
  currentActionElement.className = `big-action ${statusData.decision.action === "BUY" ? "value-positive" : statusData.decision.action === "SELL" ? "value-negative" : ""}`;
  currentSymbolBadge.textContent = statusData.decision.symbol || "n/a";

  renderFacts(decisionMainFacts, [
    ["Mercato in focus", statusData.decision.symbol || "n/a"],
    ["Perche guardiamo questo mercato", statusData.decision.focusReason || "n/a"],
    ["Motivo principale", statusData.decision.reason || "n/a"],
    ["Entrate aperte", statusData.portfolio.entryCount ?? 0],
    ["Saldo USDT disponibile", formatUsdt(statusData.portfolio.usdtBalance)],
    ["Capitale gia impegnato", formatUsdt(statusData.portfolio.budgetUsed)],
    ["Spazio residuo per nuove entrate", formatUsdt(statusData.portfolio.budgetRemaining)],
    ["RSI", formatIndicator(statusData.decision.rsi)],
    ["EMA veloce", formatPrice(statusData.decision.ema9)],
    ["EMA lenta", formatPrice(statusData.decision.ema21)]
  ]);

  shortExplanationElement.textContent = statusData.decision.shortExplanation || "Spiegazione non disponibile.";
  detailedExplanationElement.textContent = statusData.decision.detailedExplanation || "";
  renderReasonList(statusData.decision.reasonList || []);
  renderPositions(statusData.overview.positions || []);
  renderMarkets(statusData.markets || []);
  renderTrades(Array.isArray(tradesData.trades) ? tradesData.trades : []);
}

async function resetSession() {
  const confirmed = window.confirm("Vuoi davvero azzerare la sessione di paper trading?");
  if (!confirmed) {
    return;
  }

  const response = await fetch("/api/reset", {
    method: "POST"
  });

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

  const response = await fetch("/api/btc-filter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ enabled: nextValue })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "BTC filter update failed.");
  }

  btcFilterToggle.checked = Boolean(data.btcFilterEnabled);
  btcFilterToggle.disabled = false;
}

resetButton.addEventListener("click", () => {
  resetSession().catch(() => {
    resetResult.textContent = "Errore durante il reset.";
  });
});

btcFilterToggle.addEventListener("click", (event) => {
  event.preventDefault();

  updateBtcFilter().catch(() => {
    btcFilterToggle.disabled = false;
    resetResult.textContent = "Errore durante l'aggiornamento del Filtro BTC.";
  });
});

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
