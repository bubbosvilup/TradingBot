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

function formatPrice(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return Number(value).toFixed(2);
}

function formatBtc(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return Number(value).toFixed(6);
}

function formatUsdt(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  const absoluteValue = Math.abs(Number(value));
  return absoluteValue >= 100 ? Number(value).toFixed(2) : Number(value).toFixed(4);
}

function formatIndicator(value) {
  if (value === null || value === undefined) {
    return "n/a";
  }

  return Number(value).toFixed(2);
}

function formatSignedUsdt(value) {
  if (value === null || value === undefined) {
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
      return `
        <tr>
          <td>${formatDate(trade.time)}</td>
          <td>${trade.symbol || "n/a"}</td>
          <td>${trade.action}</td>
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

  const statusData = await statusResponse.json();
  const tradesData = await tradesResponse.json();

  summaryElement.textContent = statusData.bot.summary;

  renderSummaryCards([
    { label: "Bot", value: statusData.overview.botActive ? "Attivo" : "Fermo" },
    { label: "Paper trading", value: statusData.overview.paperTrading ? "Attivo" : "Disattivato" },
    { label: "Valore portafoglio", value: formatUsdt(statusData.overview.portfolioValue) },
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
    ["RSI", formatIndicator(statusData.decision.rsi)],
    ["EMA veloce", formatPrice(statusData.decision.ema9)],
    ["EMA lenta", formatPrice(statusData.decision.ema21)]
  ]);

  shortExplanationElement.textContent = statusData.decision.shortExplanation || "Spiegazione non disponibile.";
  detailedExplanationElement.textContent = statusData.decision.detailedExplanation || "";
  renderReasonList(statusData.decision.reasonList || []);
  renderMarkets(statusData.markets || []);
  renderTrades(tradesData.trades || []);
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

resetButton.addEventListener("click", () => {
  resetSession().catch(() => {
    resetResult.textContent = "Errore durante il reset.";
  });
});

loadDashboard().catch(() => {
  summaryElement.textContent = "Impossibile caricare la dashboard.";
});

setInterval(() => {
  loadDashboard().catch(() => {
    summaryElement.textContent = "Impossibile aggiornare la dashboard.";
  });
}, 4000);
