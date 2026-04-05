/**
 * Binance Clock Skew Measurement Script
 *
 * Purpose:
 *   Determine whether the observed ~1000ms WebSocket latency could be
 *   explained by local clock skew relative to Binance server time.
 *
 * Method:
 *   Calls Binance REST API GET /api/v3/time multiple times.
 *   For each request:
 *     - Record local time before send (t1)
 *     - Record local time after response (t2)
 *     - Extract Binance server time (binanceTime) from response headers
 *     - RTT = t2 - t1
 *     - Offset estimate = binanceTime - (t1 + RTT/2)
 *
 *   The offset estimates how much the local clock differs from Binance.
 *   A positive offset means the local clock is AHEAD of Binance time.
 *   A negative offset means the local clock is BEHIND Binance time.
 *
 *   We use the REST response's serverTime field as the reference.
 *   Note: Binance /api/v3/time returns { serverTime } as the time
 *   the response was generated, embedded in the JSON body.
 *
 * Interpretation:
 *   If clock offset ≈ -1000ms (local clock 1s behind Binance),
 *   then recvAt - eventTime would OVERSTATE latency by ~1000ms.
 *   The observed ~1000ms WebSocket latency could be entirely clock skew.
 *
 *   If clock offset is within ±100ms, clock skew is NOT the culprit.
 *
 * Usage:
 *   node scripts/measureClockSkew.js [symbol] [samples]
 *
 * Examples:
 *   node scripts/measureClockSkew.js          (defaults to BTCUSDT, 20 samples)
 *   node scripts/measureClockSkew.js ETHUSDT 10
 *   node scripts/measureClockSkew.js BTCUSDT 50
 */

"use strict";

const https = require("https");

const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_SAMPLES = 20;
const REQUEST_INTERVAL_MS = 500;

function now() {
  return Date.now();
}

function round(value, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function binanceGet(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.binance.com",
      port: 443,
      path: endpoint,
      method: "GET",
      headers: {
        "User-Agent": "TradingBot-ClockCheck/1.0"
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("request_timeout"));
    });

    req.end();
  });
}

async function measureOffset(index) {
  const t1 = now();
  const response = await binanceGet("/api/v3/time");
  const t2 = now();

  const rtt = t2 - t1;
  const body = JSON.parse(response.body);
  const serverTime = Number(body.serverTime);

  // Estimate: binance generated response at serverTime.
  // Assuming symmetric RTT, the one-way trip took RTT/2.
  // So our local estimate of "what time it was at Binance when we sent" is:
  //   t1 + RTT/2
  // And the offset is:
  //   serverTime - (t1 + RTT/2)
  // But we also account for server processing time, which we can't measure.
  // The midpoint approach gives a reasonable approximation:
  //   offset = serverTime - midpoint(t1, t2 - rtt_server_processing)
  // Since we don't know server processing time, we approximate:
  //   offset = serverTime - (t1 + rtt/2)
  // A more conservative estimate accounts for server processing being
  // included in RTT, so the true one-way is < RTT/2.
  // We report both estimates.

  const midpoint = t1 + rtt / 2;
  const offsetMid = serverTime - midpoint;
  const offsetMin = serverTime - t2;  // pessimistic: all RTT is server processing
  const offsetMax = serverTime - t1;  // optimistic: zero server processing

  return {
    index,
    t1,
    t2,
    rtt,
    serverTime,
    offsetMid,
    offsetMin,
    offsetMax
  };
}

function printStats(samples) {
  printStatsFor("offsetMid (midpoint estimate)", samples.map((s) => s.offsetMid));
  printStatsFor("offsetMax (optimistic / best case)", samples.map((s) => s.offsetMax));
  printStatsFor("offsetMin (pessimistic / worst case)", samples.map((s) => s.offsetMin));
  printStatsFor("RTT", samples.map((s) => s.rtt));
}

function printStatsFor(label, values) {
  if (values.length === 0) return;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  const avg = sum / values.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  console.log(`\n  ${label} (${values.length} samples):`);
  console.log(`    avg: ${round(avg)}ms  min: ${round(min)}ms  max: ${round(max)}ms`);
  console.log(`    p50: ${round(p50)}ms  p90: ${round(p90)}ms  p95: ${round(p95)}ms`);
}

async function run(samples) {
  console.log(`\nBinance Clock Skew Measurement`);
  console.log(`========================================`);
  console.log(`  Samples: ${samples}`);
  console.log(`  Interval: ${REQUEST_INTERVAL_MS}ms between requests`);
  console.log(`  Started at: ${new Date().toISOString()}`);

  const results = [];

  for (let i = 0; i < samples; i++) {
    try {
      const sample = await measureOffset(i + 1);
      results.push(sample);

      if ((i + 1) % 5 === 0) {
        console.log(`  Progress: ${i + 1}/${samples} (avg offsetMid: ${round(results.slice(0, i + 1).reduce((s, s2) => s2.offsetMid + s, 0) / (i + 1))}ms)`);
      }
    } catch (err) {
      console.log(`  Sample ${i + 1} FAILED: ${err.message}`);
    }

    if (i < samples - 1) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    }
  }

  const completed = results.length;
  if (completed === 0) {
    console.log(`\n  No successful samples. Exiting.`);
    process.exit(1);
  }

  console.log(`\n  Collection complete.`);
  printStats(results);

  // ===== INTERPRETATION =====
  console.log(`\n\n  INTERPRETATION:`);
  console.log(`  ─────────────────`);

  const avgOffsetMid = results.reduce((s, r) => s + r.offsetMid, 0) / results.length;
  const avgOffsetMax = results.reduce((s, r) => s + r.offsetMax, 0) / results.length;
  const avgOffsetMin = results.reduce((s, r) => s + r.offsetMin, 0) / results.length;
  const avgRtt = results.reduce((s, r) => s + r.rtt, 0) / results.length;

  console.log(``);
  console.log(`  Clock offset summary (Binance time - Local time):`);
  console.log(`    Midpoint estimate (avg):  ${round(avgOffsetMid)}ms`);
  console.log(`    Optimistic bound (avg):   ${round(avgOffsetMax)}ms`);
  console.log(`    Pessimistic bound (avg):  ${round(avgOffsetMin)}ms`);
  console.log(`    REST RTT (avg):           ${round(avgRtt)}ms`);
  console.log(``);

  // Can ~1s clock skew explain the ~1000ms WS latency?
  // If avgOffsetMax ≈ -1000ms, local clock is ~1s behind Binance.
  // Then: recvAt - eventTime = (true_latency) + (clock_skew_magnitude)
  // If clock is 1s behind, recvAt appears 1s later than it should,
  // making latency appear ~1s higher.
  if (avgOffsetMax < -800) {
    console.log(`  *** CLOCK SKEW IS THE CULPRIT ***`);
    console.log(`  `);
    console.log(`  The optimistic offset bound of ${round(avgOffsetMax)}ms means your local`);
    console.log(`  clock is likely ${round(Math.abs(avgOffsetMax))}ms BEHIND Binance server time.`);
    console.log(`  This would make recvAt - eventTime appear ~${round(Math.abs(avgOffsetMax))}ms higher`);
    console.log(`  than the true WebSocket network latency.`);
    console.log(`  `);
    console.log(`  The actual WS latency is likely ~${round(1000 + avgOffsetMax)}ms (not ~1000ms).`);
  } else if (avgOffsetMid < -800) {
    console.log(`  *** CLOCK SKEW IS LIKELY THE CULPRIT ***`);
    console.log(`  `);
    console.log(`  The midpoint offset of ${round(avgOffsetMid)}ms suggests significant clock skew.`);
    console.log(`  The actual WS latency could be ${round(1000 + avgOffsetMid)}ms.`);
  } else if (Math.abs(avgOffsetMid) < 100 && Math.abs(avgOffsetMax) < 200) {
    console.log(`  *** CLOCK SKEW IS NOT THE CULPRIT ***`);
    console.log(`  `);
    console.log(`  Local clock offset is within ±${round(Math.max(Math.abs(avgOffsetMid), Math.abs(avgOffsetMax)))}ms of Binance time.`);
    console.log(`  The ~1000ms WS latency is genuine, not a clock artifact.`);
  } else {
    console.log(`  *** PARTIAL CLOCK CONTRIBUTION ***`);
    console.log(`  `);
    console.log(`  Clock offset of ${round(avgOffsetMid)}ms (midpoint) / ${round(avgOffsetMax)}ms (optimistic)`);
    console.log(`  could explain ~${round(Math.abs(Math.min(avgOffsetMid, avgOffsetMax)))}ms of the observed ~1000ms latency.`);
    console.log(`  The remaining ~${round(1000 - Math.abs(Math.min(avgOffsetMid, avgOffsetMax)))}ms is likely real transport delay.`);
  }

  console.log(``);
  console.log(`  What these values mean:`);
  console.log(`    offset > 0  →  Local clock is AHEAD of Binance`);
  console.log(`    offset < 0  →  Local clock is BEHIND Binance`);
  console.log(`    If offset ≈ -1000ms, the ~1000ms WS latency is mostly clock skew.`);
  console.log(``);

  // Raw data
  console.log(`\n  RAW SAMPLE DATA:`);
  console.log(`  ──────────────────────────────────────────────────────────────`);
  console.log(`  # | RTT(ms) | offsetMax | offsetMid | offsetMin`);
  console.log(`  ──────────────────────────────────────────────────────────────`);

  for (const r of results) {
    console.log(
      `  ${String(r.index).padStart(2)} | ${String(r.rtt + "ms").padStart(7)} | ` +
      `${String(r.offsetMax + "ms").padStart(9)} | ${String(r.offsetMid + "ms").padStart(9)} | ` +
      `${String(r.offsetMin + "ms").padStart(9)}`
    );
  }

  process.exit(0);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const symbol = args[0] || DEFAULT_SYMBOL;  // symbol is unused but kept for CLI consistency
const samples = parseInt(args[1], 10) || DEFAULT_SAMPLES;

// Validate
if (!Number.isFinite(samples) || samples < 3) {
  console.error("Usage: node scripts/measureClockSkew.js [symbol] [samples>=3]");
  process.exit(1);
}

run(samples);