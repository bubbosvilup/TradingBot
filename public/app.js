const summaryCards = document.getElementById("summary-cards");
const decisionMainFacts = document.getElementById("decision-main-facts");
const currentActionElement = document.getElementById("current-action");
const currentSymbolBadge = document.getElementById("current-symbol-badge");
const marketsBody = document.getElementById("markets-body");
const tradesBody = document.getElementById("trades-body");
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

function renderTrades(trades) {
  if (!trades.length) {
    tradesBody.innerHTML = '<tr><td colspan="6">Nessuna operazione disponibile.</td></tr>';
    return;
  }

  tradesBody.innerHTML = trades
    .slice()
    .reverse()
    .map((trade) => {
      const pnlClass = getValueClass(trade.pnlUsdt);
      const shortExplanation = escapeHtml(trade.explanationShort || trade.reason || "Spiegazione non disponibile.");
      const detailedExplanation = escapeHtml(trade.detailedExplanation || "Dettaglio non disponibile.");
      const reasonItems = Array.isArray(trade.reasonList) && trade.reasonList.length > 0
        ? `<ul>${trade.reasonList.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : "";
      const budgetLine = trade.budgetUsedAfter !== undefined && trade.budgetRemainingAfter !== undefined
        ? `<p>Capitale impegnato: ${formatUsdt(trade.budgetUsedAfter)} | Spazio residuo per nuove entrate: ${formatUsdt(trade.budgetRemainingAfter)}</p>`
        : "";
      const entryLabel = trade.entryIndex && trade.action === "BUY" ? `Ingresso ${trade.entryIndex}` : trade.action;

      return `
        <tr>
          <td>${formatDate(trade.time)}</td>
          <td>${trade.symbol || "n/a"}</td>
          <td>
            <div class="trade-action-cell">
              <span>${entryLabel}</span>
              <details class="trade-info">
                <summary class="info-chip" title="Perche il bot ha preso questa decisione">i</summary>
                <div class="trade-tooltip">
                  <strong>${shortExplanation}</strong>
                  <p>${detailedExplanation}</p>
                  ${budgetLine}
                  ${reasonItems}
                </div>
              </details>
            </div>
          </td>
          <td>${formatPrice(trade.price)}</td>
          <td>${formatBtc(trade.btcAmount)}</td>
          <td class="${pnlClass}">${trade.pnlUsdt === null ? "n/a" : formatSignedUsdt(trade.pnlUsdt)}</td>
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
    { label: "Posizione aperta", value: statusData.overview.hasOpenPosition ? "Si" : "No" }
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
