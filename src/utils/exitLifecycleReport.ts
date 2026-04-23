// Module responsibility: aggregate closed-trade outcomes and structured runtime events for exit-system analysis.

import type { SystemEvent } from "../types/event.ts";
import type { ClosedTradeRecord } from "../types/trade.ts";
import type { PositionExitMechanism, PositionLifecycleEvent, PositionLifecycleState } from "../types/positionLifecycle.ts";

type EventLike = Partial<SystemEvent> & {
  message: string;
  metadata?: Record<string, any>;
};

interface AggregatedMetric {
  avgNetPnl: number | null;
  avgSignalToExecutionMs: number | null;
  count: number;
}

interface CloseSnapshot {
  botId: string;
  closeClassification: string | null;
  closeReason: string | null;
  closedAt: number;
  exitMechanism: PositionExitMechanism | null;
  lifecycleEvent: PositionLifecycleEvent | null;
  lifecycleState: PositionLifecycleState | null;
  netPnl: number;
  policyId: string | null;
  signalToExecutionMs: number | null;
  strategyId: string;
  wasManagedRecovery: boolean;
}

const PRIMARY_CLOSE_REASONS = [
  "rsi_exit_deferred",
  "rsi_exit_confirmed",
  "managed_recovery_breaker_exit",
  "reversion_price_target_hit",
  "regime_invalidation_exit",
  "protective_stop_exit",
  "time_exhaustion_exit"
];

function asNumber(value: unknown) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function round(value: number | null, digits: number = 4) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function average(values: Array<number | null | undefined>, digits: number = 4) {
  const normalized = values.filter((value) => Number.isFinite(Number(value))).map((value) => Number(value));
  if (normalized.length <= 0) return null;
  return round(normalized.reduce((sum, value) => sum + value, 0) / normalized.length, digits);
}

function groupAverage(items: CloseSnapshot[], selector: (item: CloseSnapshot) => number | null | undefined) {
  return average(items.map(selector));
}

function getEventTime(event: EventLike) {
  const metadata = event.metadata || {};
  return asNumber(event.time)
    ?? asNumber(metadata.executionTimestamp)
    ?? asNumber(metadata.signalTimestamp)
    ?? asNumber(metadata.managedRecoveryStartedAt)
    ?? asNumber(metadata.activatedAt)
    ?? asNumber(metadata.lastPublishedAt)
    ?? null;
}

function derivePrimaryCloseReason(reasons: string[]) {
  return PRIMARY_CLOSE_REASONS.find((reason) => reasons.includes(reason)) || (reasons[0] || null);
}

function isRsiReason(reason: string | null, reasons: string[]) {
  return reason === "rsi_exit_confirmed"
    || reason === "rsi_exit_deferred"
    || reasons.includes("rsi_exit_confirmed")
    || reasons.includes("rsi_exit_threshold_hit")
    || reasons.includes("rsi_exit_deferred");
}

function deriveCloseClassification(trade: ClosedTradeRecord) {
  const primaryReason = derivePrimaryCloseReason(Array.isArray(trade.exitReason) ? trade.exitReason : []);
  if (primaryReason === "rsi_exit_confirmed" && Number(trade.netPnl) < 0) {
    return "failed_rsi_exit";
  }
  return "confirmed_exit";
}

function deriveExitMechanism(reason: string | null, lifecycleEvent: PositionLifecycleEvent | null | undefined): PositionExitMechanism | null {
  if (reason === "protective_stop_exit" || lifecycleEvent === "PROTECTIVE_STOP_HIT") {
    return "protection";
  }
  if (reason === "regime_invalidation_exit" || lifecycleEvent === "REGIME_INVALIDATION") {
    return "invalidation";
  }
  if (reason === "managed_recovery_breaker_exit" || lifecycleEvent === "MANAGED_RECOVERY_BREAKER_HIT") {
    return "breaker";
  }
  if (reason === "reversion_price_target_hit" || reason === "time_exhaustion_exit" || lifecycleEvent === "PRICE_TARGET_HIT" || lifecycleEvent === "RECOVERY_TIMEOUT") {
    return "recovery";
  }
  if (reason === "rsi_exit_confirmed" || reason === "rsi_exit_deferred" || lifecycleEvent === "RSI_EXIT_HIT" || lifecycleEvent === "FAILED_RSI_EXIT") {
    return "qualification";
  }
  return null;
}

function buildCounts<T extends string | null>(items: CloseSnapshot[], selector: (item: CloseSnapshot) => T) {
  const result: Record<string, AggregatedMetric> = {};
  for (const item of items) {
    const key = selector(item) || "unknown";
    const bucket = result[key] || { avgNetPnl: null, avgSignalToExecutionMs: null, count: 0 };
    result[key] = {
      avgNetPnl: null,
      avgSignalToExecutionMs: null,
      count: bucket.count + 1
    };
  }
  for (const [key] of Object.entries(result)) {
    const group = items.filter((item) => (selector(item) || "unknown") === key);
    result[key] = {
      avgNetPnl: groupAverage(group, (item) => item.netPnl),
      avgSignalToExecutionMs: groupAverage(group, (item) => item.signalToExecutionMs),
      count: group.length
    };
  }
  return result;
}

function pearsonCorrelation(points: Array<{ x: number; y: number }>) {
  if (points.length < 3) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const avgX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const avgY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = points.reduce((sum, point) => sum + ((point.x - avgX) * (point.y - avgY)), 0);
  const left = Math.sqrt(points.reduce((sum, point) => sum + Math.pow(point.x - avgX, 2), 0));
  const right = Math.sqrt(points.reduce((sum, point) => sum + Math.pow(point.y - avgY, 2), 0));
  if (left === 0 || right === 0) return null;
  return round(numerator / (left * right), 4);
}

function buildCloseSnapshots(params: {
  closedTrades: ClosedTradeRecord[];
  events: EventLike[];
}) {
  const sellQueues = new Map<string, EventLike[]>();
  for (const event of params.events.filter((entry) => entry.message === "SELL" || entry.message === "COVER")) {
    const botId = String(event.metadata?.botId || "");
    const executionTimestamp = asNumber(event.metadata?.executionTimestamp);
    const key = `${botId}|${executionTimestamp ?? "unknown"}`;
    const queue = sellQueues.get(key) || [];
    queue.push(event);
    sellQueues.set(key, queue);
  }

  return params.closedTrades
    .slice()
    .sort((left, right) => Number(left.closedAt || 0) - Number(right.closedAt || 0))
    .map((trade) => {
      const key = `${trade.botId}|${Number(trade.closedAt || 0)}`;
      const queue = sellQueues.get(key) || [];
      const matchedLog = queue.length > 0 ? queue.shift() || null : null;
      if (matchedLog) {
        sellQueues.set(key, queue);
      }

      const reasons = Array.isArray(trade.exitReason) ? trade.exitReason : [];
      const closeReason = String(matchedLog?.metadata?.exitEvent || derivePrimaryCloseReason(reasons) || "");
      const closeClassification = matchedLog?.metadata?.closeClassification || deriveCloseClassification(trade);
      const lifecycleEvent = (matchedLog?.metadata?.lifecycleEvent || trade.lifecycleEvent || null) as PositionLifecycleEvent | null;
      const lifecycleState = (trade.lifecycleState || matchedLog?.metadata?.lifecycleState || null) as PositionLifecycleState | null;
      const exitMechanism = (matchedLog?.metadata?.exitMechanism || deriveExitMechanism(closeReason, lifecycleEvent)) as PositionExitMechanism | null;

      return {
        botId: trade.botId,
        closeClassification,
        closeReason: closeReason || null,
        closedAt: Number(trade.closedAt || 0),
        exitMechanism,
        lifecycleEvent,
        lifecycleState,
        netPnl: Number(trade.netPnl || 0),
        policyId: matchedLog?.metadata?.policyId || null,
        signalToExecutionMs: asNumber(matchedLog?.metadata?.signalToExecutionMs),
        strategyId: trade.strategyId,
        wasManagedRecovery: false
      } as CloseSnapshot;
    });
}

function pairManagedRecoveryDefers(closeSnapshots: CloseSnapshot[], events: EventLike[]) {
  const deferQueues = new Map<string, number[]>();
  for (const event of events.filter((entry) => entry.message === "rsi_exit_deferred")) {
    const botId = String(event.metadata?.botId || "");
    const strategy = String(event.metadata?.strategy || "");
    const key = `${botId}|${strategy}`;
    const queue = deferQueues.get(key) || [];
    queue.push(getEventTime(event) || 0);
    deferQueues.set(key, queue.sort((left, right) => left - right));
  }

  const deferredOutcomes: Array<{ botId: string; closeReason: string | null; netPnl: number; profitable: boolean; signalToExecutionMs: number | null }> = [];
  for (const snapshot of closeSnapshots) {
    const key = `${snapshot.botId}|${snapshot.strategyId}`;
    const queue = deferQueues.get(key) || [];
    if (queue.length <= 0) continue;
    if (queue[0] > snapshot.closedAt) continue;
    queue.shift();
    deferQueues.set(key, queue);
    snapshot.wasManagedRecovery = true;
    deferredOutcomes.push({
      botId: snapshot.botId,
      closeReason: snapshot.closeReason,
      netPnl: snapshot.netPnl,
      profitable: snapshot.netPnl > 0,
      signalToExecutionMs: snapshot.signalToExecutionMs
    });
  }

  return {
    deferredEnteredCount: events.filter((entry) => entry.message === "rsi_exit_deferred").length,
    deferredOutcomes,
    pairedClosedOutcomeCount: deferredOutcomes.length,
    unpairedDeferredCount: Math.max(events.filter((entry) => entry.message === "rsi_exit_deferred").length - deferredOutcomes.length, 0)
  };
}

function analyzeLatch(events: EventLike[]) {
  const activations = events.filter((entry) => entry.message === "post_loss_architect_latch_activated");
  const blocks = events.filter((entry) => entry.message === "entry_blocked" && entry.metadata?.reason === "post_loss_architect_latch");
  const releases = events.filter((entry) => entry.message === "post_loss_architect_latch_released");
  const buys = events.filter((entry) => entry.message === "BUY" || entry.message === "SHORT");

  const laterEntries = [];
  for (const release of releases) {
    const botId = String(release.metadata?.botId || "");
    const releaseTime = getEventTime(release);
    if (releaseTime === null) continue;
    const nextBuy = buys.find((entry) => String(entry.metadata?.botId || "") === botId && (getEventTime(entry) || 0) >= releaseTime);
    if (nextBuy) {
      laterEntries.push(nextBuy);
    }
  }

  return {
    activations: activations.length,
    avgFreshPublishesBeforeRelease: average(releases.map((entry) => asNumber(entry.metadata?.freshPublishCount)), 2),
    blockedEntries: blocks.length,
    releasedCount: releases.length,
    releasedWithLaterEntryCount: laterEntries.length,
    releasedWithLaterEntryRate: releases.length > 0 ? round(laterEntries.length / releases.length, 4) : null,
    laterEntryAvgDecisionConfidence: average(laterEntries.map((entry) => asNumber(entry.metadata?.decisionConfidence))),
    laterEntryAvgExpectedNetEdgePct: average(laterEntries.map((entry) => asNumber(entry.metadata?.expectedNetEdgePct)))
  };
}

function buildLatencySummary(closeSnapshots: CloseSnapshot[], deferredOutcomes: Array<{ profitable: boolean; signalToExecutionMs: number | null }>) {
  const latencyByCloseReason: Record<string, number | null> = {};
  const reasons = Array.from(new Set(closeSnapshots.map((snapshot) => snapshot.closeReason || "unknown")));
  for (const reason of reasons) {
    latencyByCloseReason[reason] = average(
      closeSnapshots
        .filter((snapshot) => (snapshot.closeReason || "unknown") === reason)
        .map((snapshot) => snapshot.signalToExecutionMs),
      2
    );
  }

  const correlationPoints = closeSnapshots
    .filter((snapshot) => Number.isFinite(Number(snapshot.signalToExecutionMs)))
    .map((snapshot) => ({
      x: Number(snapshot.signalToExecutionMs),
      y: Number(snapshot.netPnl)
    }));

  return {
    avgSignalToExecutionMsByCloseReason: latencyByCloseReason,
    failedRsiAvgSignalToExecutionMs: average(
      closeSnapshots
        .filter((snapshot) => snapshot.closeClassification === "failed_rsi_exit")
        .map((snapshot) => snapshot.signalToExecutionMs),
      2
    ),
    latencyToNetPnlCorrelation: pearsonCorrelation(correlationPoints),
    recoveredDeferredAvgSignalToExecutionMs: average(
      deferredOutcomes
        .filter((outcome) => outcome.profitable)
        .map((outcome) => outcome.signalToExecutionMs),
      2
    )
  };
}

function buildManagedRecoverySummary(closeSnapshots: CloseSnapshot[], deferredPairing: { deferredEnteredCount: number; pairedClosedOutcomeCount: number; unpairedDeferredCount: number }) {
  const managedRecoveryCloses = closeSnapshots.filter((snapshot) => snapshot.wasManagedRecovery);
  const byReason = (reason: string) => managedRecoveryCloses.filter((snapshot) => snapshot.closeReason === reason);
  return {
    avgNetPnlByExitType: {
      breaker: groupAverage(byReason("managed_recovery_breaker_exit"), (snapshot) => snapshot.netPnl),
      invalidation: groupAverage(byReason("regime_invalidation_exit"), (snapshot) => snapshot.netPnl),
      protection: groupAverage(byReason("protective_stop_exit"), (snapshot) => snapshot.netPnl),
      target: groupAverage(byReason("reversion_price_target_hit"), (snapshot) => snapshot.netPnl),
      timeout: groupAverage(byReason("time_exhaustion_exit"), (snapshot) => snapshot.netPnl)
    },
    deferredEventCount: deferredPairing.deferredEnteredCount,
    pairedClosedOutcomeCount: deferredPairing.pairedClosedOutcomeCount,
    unpairedDeferredCount: deferredPairing.unpairedDeferredCount,
    enteredCount: closeSnapshots.filter((snapshot) => snapshot.wasManagedRecovery).length,
    exitedBy: {
      breaker: byReason("managed_recovery_breaker_exit").length,
      invalidation: byReason("regime_invalidation_exit").length,
      protection: byReason("protective_stop_exit").length,
      target: byReason("reversion_price_target_hit").length,
      timeout: byReason("time_exhaustion_exit").length
    }
  };
}

function buildRsiSummary(closeSnapshots: CloseSnapshot[], deferredOutcomes: Array<{ netPnl: number; profitable: boolean }>, deferredEnteredCount: number) {
  const rsiCloses = closeSnapshots.filter((snapshot) => snapshot.closeReason === "rsi_exit_confirmed");
  return {
    confirmedProfitableCount: rsiCloses.filter((snapshot) => snapshot.netPnl > 0).length,
    deferredEnteredCount,
    deferredEndedNegativeCount: deferredOutcomes.filter((outcome) => !outcome.profitable).length,
    deferredRecoveredProfitableCount: deferredOutcomes.filter((outcome) => outcome.profitable).length,
    failedCount: closeSnapshots.filter((snapshot) => snapshot.closeClassification === "failed_rsi_exit").length
  };
}

function buildReportSummary(closeSnapshots: CloseSnapshot[]) {
  return {
    byCloseClassification: buildCounts(closeSnapshots, (snapshot) => snapshot.closeClassification),
    byCloseReason: buildCounts(closeSnapshots, (snapshot) => snapshot.closeReason),
    byExitMechanism: buildCounts(closeSnapshots, (snapshot) => snapshot.exitMechanism),
    byLifecycleEvent: buildCounts(closeSnapshots, (snapshot) => snapshot.lifecycleEvent),
    byLifecycleState: buildCounts(closeSnapshots, (snapshot) => snapshot.lifecycleState),
    byPolicyId: buildCounts(closeSnapshots, (snapshot) => snapshot.policyId),
    totalClosedTrades: closeSnapshots.length
  };
}

function buildExitLifecycleReport(params: {
  closedTrades?: ClosedTradeRecord[];
  events?: EventLike[];
}) {
  const closedTrades = Array.isArray(params.closedTrades) ? params.closedTrades : [];
  const events = Array.isArray(params.events) ? params.events : [];
  const closeSnapshots = buildCloseSnapshots({ closedTrades, events });
  const deferredPairing = pairManagedRecoveryDefers(closeSnapshots, events);
  const summary = buildReportSummary(closeSnapshots);
  const managedRecovery = buildManagedRecoverySummary(closeSnapshots, deferredPairing);
  const rsi = buildRsiSummary(closeSnapshots, deferredPairing.deferredOutcomes, deferredPairing.deferredEnteredCount);
  const latch = analyzeLatch(events);
  const timing = buildLatencySummary(closeSnapshots, deferredPairing.deferredOutcomes);

  return {
    assumptions: [
      "Policy, mechanism, classification, and latency come from structured runtime logs when available; closed trades are used as the canonical netPnL source.",
      "Managed recovery outcomes are paired from rsi_exit_deferred to the next closed trade for the same bot/strategy, assuming one open position per bot.",
      "Before-vs-after improvement cannot be proven without a baseline dataset from the older exit path."
    ],
    managedRecovery,
    rsi,
    summary,
    timing,
    latch
  };
}

function renderMetricMap(title: string, metrics: Record<string, AggregatedMetric>) {
  const lines = [`${title}:`];
  for (const [key, metric] of Object.entries(metrics)) {
    lines.push(`- ${key}: count=${metric.count}, avgNetPnl=${metric.avgNetPnl ?? "n/a"}, avgSignalToExecutionMs=${metric.avgSignalToExecutionMs ?? "n/a"}`);
  }
  return lines.join("\n");
}

function renderExitLifecycleReport(report: ReturnType<typeof buildExitLifecycleReport>) {
  return [
    "Exit Lifecycle Report",
    `Closed trades: ${report.summary.totalClosedTrades}`,
    "",
    renderMetricMap("By Close Reason", report.summary.byCloseReason),
    "",
    renderMetricMap("By Close Classification", report.summary.byCloseClassification),
    "",
    renderMetricMap("By Exit Mechanism", report.summary.byExitMechanism),
    "",
    `Managed recovery: deferred=${report.managedRecovery.deferredEventCount}, pairedClosed=${report.managedRecovery.pairedClosedOutcomeCount}, openDeferred=${report.managedRecovery.unpairedDeferredCount}, breaker=${report.managedRecovery.exitedBy.breaker}, target=${report.managedRecovery.exitedBy.target}, timeout=${report.managedRecovery.exitedBy.timeout}, invalidation=${report.managedRecovery.exitedBy.invalidation}, protection=${report.managedRecovery.exitedBy.protection}`,
    `Managed recovery avg netPnL: breaker=${report.managedRecovery.avgNetPnlByExitType.breaker ?? "n/a"}, target=${report.managedRecovery.avgNetPnlByExitType.target ?? "n/a"}, timeout=${report.managedRecovery.avgNetPnlByExitType.timeout ?? "n/a"}, invalidation=${report.managedRecovery.avgNetPnlByExitType.invalidation ?? "n/a"}, protection=${report.managedRecovery.avgNetPnlByExitType.protection ?? "n/a"}`,
    `RSI exits: confirmedProfitable=${report.rsi.confirmedProfitableCount}, failed=${report.rsi.failedCount}, deferredRecovered=${report.rsi.deferredRecoveredProfitableCount}, deferredNegative=${report.rsi.deferredEndedNegativeCount}`,
    `Post-loss latch: activations=${report.latch.activations}, blockedEntries=${report.latch.blockedEntries}, avgFreshPublishesBeforeRelease=${report.latch.avgFreshPublishesBeforeRelease ?? "n/a"}, releasedWithLaterEntry=${report.latch.releasedWithLaterEntryCount}`,
    `Timing: failedRsiAvgSignalToExecutionMs=${report.timing.failedRsiAvgSignalToExecutionMs ?? "n/a"}, recoveredDeferredAvgSignalToExecutionMs=${report.timing.recoveredDeferredAvgSignalToExecutionMs ?? "n/a"}, latencyToNetPnlCorrelation=${report.timing.latencyToNetPnlCorrelation ?? "n/a"}`
  ].join("\n");
}

module.exports = {
  buildExitLifecycleReport,
  renderExitLifecycleReport
};
