/**
 * Binance WebSocket Latency Measurement Script
 *
 * Purpose:
 *   Isolate whether the observed ~900-1000ms "Exchange -> WS" latency is:
 *   (a) genuine network/infrastructure delay, or
 *   (b) an artifact of which exchange timestamp field we compare against.
 *
 * Background:
 *   WSManager.onSocketMessage computes latency as: receivedAt - extractEventTime(data)
 *   extractEventTime returns: data.T (trade time) || data.E (event time)
 *
 *   Binance "trade" and "aggTrade" streams include TWO timestamps:
 *   - T (tradeTime): When the trade occurred on the exchange matching engine
 *   - E (eventTime): When the exchange produced the streaming event
 *
 *   Using T measures: trade processing delay + event generation + network latency
 *   Using E measures: event send-to-receive network latency only
 *
 *   If T and E differ by ~900ms on average, the ~1000ms "Exchange -> WS" metric
 *   is a timestamp comparison artifact, not actual network slowness.
 *
 * Usage:
 *   node scripts/measureWsLatency.js [symbol] [samples]
 *
 * Examples:
 *   node scripts/measureWsLatency.js BTC/USDT 100
 *   node scripts/measureWsLatency.js ETH/USDT 50
 *   node scripts/measureWsLatency.js  (defaults to BTC/USDT, 200 samples)
 */

"use strict";

const WebSocket = require("ws");

const DEFAULT_SYMBOL = "BTC/USDT";
const DEFAULT_SAMPLES = 200;
const STREAM_TYPE = "trade"; // "trade" = individual, "aggTrade" = aggregated

function toBinanceSymbol(symbol) {
  return symbol.replace("/", "").toLowerCase();
}

function normalizeSymbol(symbol) {
  const quotes = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "BTC", "ETH", "BNB", "EUR", "TRY"];
  const normalized = symbol.toUpperCase();
  for (const quote of quotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) {
      return `${normalized.slice(0, -quote.length)}/${quote}`;
    }
  }
  return normalized;
}

function now() {
  return Date.now();
}

function round(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function buildStreamName(symbol, streamType) {
  return `${toBinanceSymbol(symbol)}@${streamType}`;
}

function printStats(title, measurements) {
  if (measurements.length === 0) return;

  const values = measurements.map((m) => m.latencyMs).filter((v) => v !== null);
  if (values.length === 0) return;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const avg = sum / values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  console.log(`\n  ${title} (${values.length} samples):`);
  console.log(`    avg: ${round(avg)}ms  min: ${round(min)}ms  max: ${round(max)}ms`);
  console.log(`    p50: ${round(p50)}ms  p90: ${round(p90)}ms  p95: ${round(p95)}ms  p99: ${round(p99)}ms`);
}

function printTeTimeDelta(measurements) {
  const deltas = measurements
    .map((m) => ({ tMinusE: m.tradeTime - m.eventTime }))
    .map((m) => m.tMinusE);

  if (deltas.length === 0) return;

  const sorted = [...deltas].sort((a, b) => a - b);
  const sum = deltas.reduce((s, v) => s + v, 0);
  const avg = sum / deltas.length;

  console.log(`\n  T - E delta (tradeTime minus eventTime):`);
  console.log(`    avg: ${round(avg)}ms  min: ${round(sorted[0])}ms  max: ${round(sorted[sorted.length - 1])}ms`);
  console.log(`    p50: ${round(sorted[Math.floor(sorted.length * 0.5)])}ms`);
}

function measure(symbol, targetSamples) {
  const streamName = buildStreamName(symbol, STREAM_TYPE);
  const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;
  const userSymbol = normalizeSymbol(symbol);

  console.log(`\nBinance WebSocket Latency Measurement`);
  console.log(`========================================`);
  console.log(`  Symbol: ${userSymbol} (${toBinanceSymbol(symbol)})`);
  console.log(`  Stream: ${STREAM_TYPE}`);
  console.log(`  Target samples: ${targetSamples}`);
  console.log(`  Started at: ${new Date().toISOString()}`);

  const measurements = [];
  const startTime = now();

  // Track T-E delta separately to show the difference between trade time and event time
  function onMessage(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    // Handle combined stream format: { stream: "...", data: { ... } }
    const data = payload.data || payload;

    // Skip non-trade messages
    if (data.e !== "trade" && data.e !== "aggTrade") return;

    const receivedAt = now();
    const tradeTime = Number(data.T);  // When trade occurred on exchange
    const eventTime = Number(data.E);  // When event was generated/pushed

    const latencyViaT = receivedAt - tradeTime;
    const latencyViaE = receivedAt - eventTime;
    const tMinusE = tradeTime - eventTime;

    const sample = {
      eventType: data.e,
      eventTime,
      tradeTime,
      receivedAt,
      latencyMs: latencyViaT,
      latencyViaE,
      price: Number(data.p),
      tMinusE,
      sampleIndex: measurements.length + 1
    };

    measurements.push(sample);

    // Print every 10 samples for progress feedback
    if (sample.sampleIndex % 10 === 0) {
      const elapsedMs = now() - startTime;
      console.log(`  Progress: ${sample.sampleIndex}/${targetSamples} (${round(elapsedMs / 1000)}s elapsed)`);
    }

    if (measurements.length >= targetSamples) {
      ws.close();
    }
  }

  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log(`\n  WebSocket connected at: ${new Date().toISOString()}`);
    console.log(`  Receiving ${targetSamples} samples...`);
  });

  ws.on("error", (err) => {
    console.error(`  WebSocket error: ${err.message}`);
    process.exit(1);
  });

  ws.on("close", () => {
    const totalElapsed = now() - startTime;

    // ===== COMPARATIVE ANALYSIS =====
    console.log(`\n  Collection complete (${round(totalElapsed / 1000)}s total)`);

    // Latency via T (what current code measures)
    printStats("Latency via T (receivedAt - tradeTime) [CURRENT METRIC]", measurements);

    // Latency via E (network-only latency)
    const eMeasurements = measurements.map((m) => ({ latencyMs: m.latencyViaE }));
    printStats("Latency via E (receivedAt - eventTime) [NETWORK ONLY]", eMeasurements);

    // T-E delta
    printTeTimeDelta(measurements);

    // ===== INTERPRETATION GUIDE =====
    console.log(`\n\n  INTERPRETATION:`);
    console.log(`  ─────────────────`);

    const tValues = measurements.map((m) => m.latencyMs);
    const eValues = measurements.map((m) => m.latencyViaE);
    const teDeltas = measurements.map((m) => m.tMinusE);

    const avgT = tValues.reduce((s, v) => s + v, 0) / tValues.length;
    const avgE = eValues.reduce((s, v) => s + v, 0) / eValues.length;
    const avgDelta = teDeltas.reduce((s, v) => s + v, 0) / teDeltas.length;

    console.log(``);
    if (avgT > 800 && avgE < 200) {
      console.log(`  *** The ~${round(avgT)}ms "Exchange -> WS" latency is a TIMESTAMP ARTIFACT. ***`);
      console.log(`  `);
      console.log(`  The average T-E delta of ${round(avgDelta)}ms means the trade timestamp`);
      console.log(`  is ${round(avgDelta)}ms behind the event timestamp. This is NOT network latency;`);
      console.log(`  it reflects the delay between when a trade occurred and when the exchange`);
      console.log(`  published the streaming event.`);
      console.log(`  `);
      console.log(`  The ACTUAL network latency (via E) is ~${round(avgE)}ms.`);
    } else if (avgT > 800 && avgE > 500) {
      console.log(`  *** The ~${round(avgT)}ms latency is GENUINE network/infrastructure delay. ***`);
      console.log(`  `);
      console.log(`  Even using eventTime (E), the latency is ~${round(avgE)}ms, which confirms`);
      console.log(`  that the delay is in the WebSocket transport path itself.`);
    } else if (avgT < 500) {
      console.log(`  *** Latency is within normal range: ~${round(avgT)}ms ***`);
    } else {
      console.log(`  *** Mixed signals. avgT=${round(avgT)}ms, avgE=${round(avgE)}ms, avgDelta=${round(avgDelta)}ms ***`);
    }

    console.log(``);
    console.log(`  Binance timestamp definitions:`);
    console.log(`    T = tradeTime  — when trade matched on exchange engine`);
    console.log(`    E = eventTime  — when exchange pushed the event to stream`);
    console.log(`    Current code uses T (tradeTime) as the exchange timestamp.`);
    console.log(``);

    // Raw data for deep analysis
    console.log(`\n  RAW SAMPLE DATA (first 20):`);
    console.log(`  ──────────────────────────────────────────────────────────────`);
    console.log(`  # | TradeTime | EventTime | T-E    | recv-T   | recv-E   | Price`);
    console.log(`  ──────────────────────────────────────────────────────────────`);

    const first20 = measurements.slice(0, 20);
    for (const s of first20) {
      console.log(
        `  ${String(s.sampleIndex).padStart(2)} | ${s.tradeTime} | ${s.eventTime} | ` +
        `${String(s.tMinusE + "ms").padStart(6)} | ${String(s.latencyMs + "ms").padStart(8)} | ` +
        `${String(s.latencyViaE + "ms").padStart(8)} | ${s.price}`
      );
    }

    process.exit(0);
  });

  ws.on("message", onMessage);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const symbol = args[0] || DEFAULT_SYMBOL;
const samples = parseInt(args[1], 10) || DEFAULT_SAMPLES;

measure(symbol, samples);