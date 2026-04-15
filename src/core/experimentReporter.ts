/**
 * Experiment Metrics Reporter — tracks metrics from authoritative trade lifecycle events.
 *
 * In silent mode: no console output, writes 2-line report to Desktop on shutdown.
 */

import type { BotConfig } from "../types/bot.ts";

export interface ExperimentMetricsConfig {
  enabled: boolean;
  label: string;
  summaryIntervalMs: number;
}

export interface ExperimentReporterParams {
  store: any;
  logger: any;
  config: ExperimentMetricsConfig | undefined;
  loggingMode?: string;
}

export interface ExperimentReporterInstance {
  isEnabled(): boolean;
  getLabel(): string;
  getSummaryIntervalMs(): number;
  logSummary(): void;
  logFinalSummary(): void;
  writeCheckpoint(): void;
  writeDesktopReport(): void;
}

function round(value: number, decimals: number = 4): number {
  return Number(value.toFixed(decimals));
}

function asNumber(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function getDesktopPath(): string {
  const homedir = require("os").homedir();
  return require("path").join(homedir, "Desktop");
}

function getPrimaryReportDir(): string {
  const path = require("path");
  const explicitDir = String(process.env.EXPERIMENT_REPORT_DIR || "").trim();
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  return path.join(process.cwd(), "reports", "experiments");
}

function getDesktopCandidatePaths(): string[] {
  if (String(process.env.EXPERIMENT_REPORT_DISABLE_DESKTOP || "").trim() === "1") {
    return [];
  }
  const path = require("path");
  const os = require("os");
  const candidates = [
    process.env.DESKTOP,
    process.env.ONEDRIVE ? path.join(process.env.ONEDRIVE, "Desktop") : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : null,
    getDesktopPath(),
    os.homedir() ? path.join(os.homedir(), "OneDrive", "Desktop") : null
  ].filter((value: string | null | undefined): value is string => Boolean(String(value || "").trim()));
  return Array.from(new Set(candidates.map((value) => path.resolve(value))));
}

function ensureParentDir(filePath: string): void {
  const fs = require("fs");
  const path = require("path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function tryWriteFile(filePath: string, content: string): boolean {
  const fs = require("fs");
  try {
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

function buildReportBasename(label: string): string {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `tradingbot_experiment_${safeLabel}`;
}

function buildReportLine1(label: string, elapsedMs: number, m: Record<string, unknown>): string {
  return [
    `label=${label}`,
    `elapsedMs=${elapsedMs}`,
    `totalNetPnl=${m.totalNetPnl ?? "null"}`,
    `closedTradesCount=${m.closedTradesCount ?? 0}`,
    `avgNetPnl=${m.avgNetPnl ?? "null"}`,
    `winRate=${m.winRate ?? "null"}`,
    `profitFactor=${m.profitFactor ?? "null"}`,
    `entryOpened=${m.entryOpened ?? 0}`,
    `entryBlocked=${m.entryBlocked ?? 0}`,
    `entrySkipped=${m.entrySkipped ?? 0}`
  ].join(" | ");
}

function buildReportLine2(m: Record<string, unknown>): string {
  return [
    `managedRecoveryEntries=${m.managedRecoveryEntries ?? 0}`,
    `managedRecoveryClosedOutcomes=${m.managedRecoveryClosedOutcomes ?? 0}`,
    `managedRecoveryOpenDeferredEvents=${m.managedRecoveryOpenDeferredEvents ?? 0}`,
    `managedRecoveryUnpairedDeferredEvents=${m.managedRecoveryUnpairedDeferredEvents ?? 0}`,
    `exitManagedRecoveryBreaker=${m.exitManagedRecoveryBreaker ?? 0}`,
    `exitManagedRecoveryTimeout=${m.exitManagedRecoveryTimeout ?? 0}`,
    `exitManagedRecoveryTarget=${m.exitManagedRecoveryTarget ?? 0}`,
    `exitManagedRecoveryInvalidation=${m.exitManagedRecoveryInvalidation ?? 0}`,
    `exitManagedRecoveryProtection=${m.exitManagedRecoveryProtection ?? 0}`,
    `exitManagedRecoveryOther=${m.exitManagedRecoveryOther ?? 0}`,
    `exitNormal=${m.exitNormal ?? 0}`,
    `exitProtectiveStop=${m.exitProtectiveStop ?? 0}`,
    `totalAccountedExits=${m.totalAccountedExits ?? 0}`,
    `avgHoldPipelineMs=${m.avgHoldPipelineMs ?? "null"}`,
    `reconciliationError=${m.reconciliationError ?? 0}`
  ].join(" | ");
}

const QUARANTINED_EXPERIMENT_LABELS = new Set([
  "allow_small_loss_floor05"
]);

function normalizeExperimentConfig(config: ExperimentMetricsConfig | undefined): ExperimentMetricsConfig {
  const nextConfig = config ?? {
    enabled: false,
    label: "",
    summaryIntervalMs: 60_000
  };
  const label = String(nextConfig.label || "").trim();
  if (!QUARANTINED_EXPERIMENT_LABELS.has(label)) {
    return nextConfig;
  }
  return {
    ...nextConfig,
    enabled: false,
    label: `quarantined_${label}`
  };
}

// Classify a single ClosedTradeRecord into an exit bucket.
// Returns one of: "normal", "protective_stop", "recovery_breaker", "recovery_timeout", "recovery_target",
//                  "recovery_invalidation", "recovery_protection", "recovery_other"
function classifyExit(trade: any): string {
  const exitReason = Array.isArray(trade.exitReason) ? trade.exitReason.join(",") : String(trade.exitReason || "");
  const lifecycleEvent = String(trade.lifecycleEvent || "");
  const lifecycleState = String(trade.lifecycleState || "");
  const lifecycleMode = String(trade.lifecycleMode || "");
  if (exitReason.includes("managed_recovery_breaker") || lifecycleEvent === "MANAGED_RECOVERY_BREAKER_HIT") {
    return "recovery_breaker";
  }
  const isManagedRecovery = lifecycleMode === "managed_recovery" ||
    exitReason.includes("managed_recovery") ||
    lifecycleEvent.includes("RSI_EXIT") ||
    lifecycleEvent.includes("RECOVERY") ||
    lifecycleState.includes("recovery");

  if (isManagedRecovery) {
    if (exitReason.includes("timeout") || exitReason.includes("time_exhaustion") ||
        lifecycleEvent === "RECOVERY_TIMEOUT" || lifecycleEvent === "TIME_EXHAUSTION_EXIT") {
      return "recovery_timeout";
    }
    if (exitReason.includes("price_target") || lifecycleEvent === "PRICE_TARGET_HIT" ||
        lifecycleEvent === "RECOVERY_TARGET") {
      return "recovery_target";
    }
    if (exitReason.includes("invalidation") || lifecycleEvent === "REGIME_INVALIDATION" ||
        lifecycleEvent === "INVALIDATION_EXIT") {
      return "recovery_invalidation";
    }
    if (exitReason.includes("protective_stop") || lifecycleEvent === "PROTECTIVE_STOP_HIT" ||
        lifecycleEvent === "PROTECTIVE_STOP_EXIT") {
      return "recovery_protection";
    }
    return "recovery_other";
  }

  // Non-managed-recovery exits
  if (exitReason.includes("protective_stop") || lifecycleEvent === "PROTECTIVE_STOP_HIT" ||
      lifecycleEvent === "PROTECTIVE_STOP_EXIT") {
    return "protective_stop";
  }

  return "normal";
}

class ExperimentReporter implements ExperimentReporterInstance {
  private store: any;
  private logger: any;
  private config: ExperimentMetricsConfig;
  private loggingMode: string;
  private startAt: number;

  constructor(params: ExperimentReporterParams) {
    this.store = params.store;
    this.logger = params.logger;
    this.config = normalizeExperimentConfig(params.config);
    this.loggingMode = params.loggingMode || "normal";
    this.startAt = Date.now();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getLabel(): string {
    return this.config.label || "experiment";
  }

  getSummaryIntervalMs(): number {
    return this.config.summaryIntervalMs;
  }

  isSilent(): boolean {
    return this.loggingMode === "silent";
  }

  logSummary(): void {
    if (this.isSilent()) return;
    const summary = this.collectMetrics();
    this.logger.info("experiment_summary", {
      label: this.getLabel(),
      elapsedMs: Date.now() - this.startAt,
      ...summary
    });
  }

  logFinalSummary(): void {
    // Always write a final report when experiment is enabled
    this.writeDesktopReport();
    // Also log to console if not in silent mode
    if (!this.isSilent()) {
      const summary = this.collectMetrics();
      this.logger.info("experiment_final_summary", {
        label: this.getLabel(),
        elapsedMs: Date.now() - this.startAt,
        ...summary
      });
    }
  }

  writeCheckpoint(): void {
    let summary: Record<string, unknown>;
    try {
      summary = this.collectMetrics();
    } catch {
      return;
    }
    const label = this.getLabel();
    const elapsedMs = Date.now() - this.startAt;
    const content = `${buildReportLine1(label, elapsedMs, summary)}\n${buildReportLine2(summary)}\n`;
    const latestPath = require("path").join(getPrimaryReportDir(), `${buildReportBasename(label)}_latest.txt`);
    tryWriteFile(latestPath, content);
  }

  writeDesktopReport(): void {
    let summary: Record<string, unknown>;
    try {
      summary = this.collectMetrics();
    } catch (err: any) {
      console.error(`[experiment] collectMetrics failed: ${err?.message || err}`);
      summary = {
        totalNetPnl: 0,
        closedTradesCount: 0,
        totalAccountedExits: 0,
        reconciliationError: 0,
        avgNetPnl: null,
        winRate: null,
        profitFactor: null,
        entryEvals: 0,
        entryOpened: 0,
        entryBlocked: 0,
        entrySkipped: 0,
        managedRecoveryEntries: 0,
        managedRecoveryAvgNetPnl: null,
        exitNormal: 0,
        exitProtectiveStop: 0,
        exitManagedRecoveryBreaker: 0,
        exitManagedRecoveryTimeout: 0,
        exitManagedRecoveryTarget: 0,
        exitManagedRecoveryInvalidation: 0,
        exitManagedRecoveryProtection: 0,
        exitManagedRecoveryOther: 0,
        exitManagedRecoveryTotal: 0,
        managedRecoveryUnpairedDeferredEvents: 0,
        avgHoldPipelineMs: null
      };
    }

    const label = this.getLabel();
    const elapsedMs = Date.now() - this.startAt;
    const line1 = buildReportLine1(label, elapsedMs, summary);
    const line2 = buildReportLine2(summary);
    const content = `${line1}\n${line2}\n`;

    const path = require("path");
    const basename = buildReportBasename(label);
    const filename = `${basename}_${formatTimestamp()}.txt`;
    const primaryDir = getPrimaryReportDir();
    const primaryLatestPath = path.join(primaryDir, `${basename}_latest.txt`);
    const primaryFinalPath = path.join(primaryDir, filename);
    const writtenPaths: string[] = [];

    if (tryWriteFile(primaryLatestPath, content)) {
      writtenPaths.push(primaryLatestPath);
    }
    if (tryWriteFile(primaryFinalPath, content)) {
      writtenPaths.push(primaryFinalPath);
    }

    for (const desktopPath of getDesktopCandidatePaths()) {
      const desktopFilePath = path.join(desktopPath, filename);
      if (tryWriteFile(desktopFilePath, content)) {
        writtenPaths.push(desktopFilePath);
        break;
      }
    }

    if (writtenPaths.length === 0) {
      const tmpPath = path.join(require("os").tmpdir(), filename);
      if (tryWriteFile(tmpPath, content)) {
        writtenPaths.push(tmpPath);
      }
    }

    if (writtenPaths.length === 0) {
      console.error("[experiment] Report write failed in every known location");
      return;
    }

    if (!this.isSilent()) {
      this.logger.info("experiment_report_written", {
        paths: writtenPaths.join(" ; ")
      });
    }
  }

  private collectMetrics(): Record<string, unknown> {
    // Read closed trades directly from the authoritative store source
    const store = this.store;
    const closedTradesMap = store.closedTrades instanceof Map ? store.closedTrades : new Map();
    const allClosedTrades: any[] = [];
    for (const trades of closedTradesMap.values()) {
      if (Array.isArray(trades)) {
        allClosedTrades.push(...trades);
      }
    }
    allClosedTrades.sort((a, b) => Number(a.closedAt || 0) - Number(b.closedAt || 0));

    // Count exits from actual closed trade records
    let exitNormal = 0;
    let exitProtectiveStop = 0;
    let exitManagedRecoveryTimeout = 0;
    let exitManagedRecoveryTarget = 0;
    let exitManagedRecoveryInvalidation = 0;
    let exitManagedRecoveryProtection = 0;
    let exitManagedRecoveryBreaker = 0;
    let exitManagedRecoveryOther = 0;
    let totalNetPnl = 0;
    let totalWins = 0;
    let managedRecoveryNetPnl = 0;
    let managedRecoveryPnlCount = 0;

    for (const trade of allClosedTrades) {
      const netPnl = Number(trade.netPnl || trade.pnl || 0);
      totalNetPnl += netPnl;
      if (netPnl > 0) totalWins += 1;

      const bucket = classifyExit(trade);
      switch (bucket) {
        case "normal": exitNormal += 1; break;
        case "protective_stop": exitProtectiveStop += 1; break;
        case "recovery_breaker": exitManagedRecoveryBreaker += 1; break;
        case "recovery_timeout": exitManagedRecoveryTimeout += 1; break;
        case "recovery_target": exitManagedRecoveryTarget += 1; break;
        case "recovery_invalidation": exitManagedRecoveryInvalidation += 1; break;
        case "recovery_protection": exitManagedRecoveryProtection += 1; break;
        case "recovery_other":
          exitManagedRecoveryOther += 1;
          const mrPnl = asNumber(trade.netPnl);
          if (mrPnl !== null) {
            managedRecoveryNetPnl += mrPnl;
            managedRecoveryPnlCount += 1;
          }
          break;
      }

      // Also count managed recovery PnL from resolved recovery safety and exit outcomes.
      if (bucket === "recovery_breaker" || bucket === "recovery_target" || bucket === "recovery_timeout" || bucket === "recovery_invalidation") {
        const mrPnl = asNumber(trade.netPnl);
        if (mrPnl !== null) {
          managedRecoveryNetPnl += mrPnl;
          managedRecoveryPnlCount += 1;
        }
      }
    }

    const totalTrades = allClosedTrades.length;
    const exitManagedRecoveryTotal = exitManagedRecoveryBreaker + exitManagedRecoveryTimeout + exitManagedRecoveryTarget + exitManagedRecoveryInvalidation + exitManagedRecoveryProtection + exitManagedRecoveryOther;
    const totalAccountedExits = exitNormal + exitProtectiveStop + exitManagedRecoveryTotal;
    const reconciliationError = totalTrades - totalAccountedExits;

    const avgNetPnl = totalTrades > 0 ? round(totalNetPnl / totalTrades) : null;
    const winRate = totalTrades > 0 ? round(totalWins / totalTrades) : null;
    const grossProfit = allClosedTrades.filter((t) => Number(t.netPnl || t.pnl || 0) > 0).reduce((s, t) => s + Number(t.netPnl || t.pnl || 0), 0);
    const grossLoss = Math.abs(allClosedTrades.filter((t) => Number(t.netPnl || t.pnl || 0) < 0).reduce((s, t) => s + Number(t.netPnl || t.pnl || 0), 0));
    const profitFactor = grossLoss > 0 ? round(grossProfit / grossLoss) : null;
    const managedRecoveryAvgNetPnl = managedRecoveryPnlCount > 0 ? round(managedRecoveryNetPnl / managedRecoveryPnlCount) : null;

    // Entry counters from bot state
    const botStates = store.botStates instanceof Map ? Array.from(store.botStates.values()) : [];
    let totalEval = 0;
    let totalOpened = 0;
    let totalBlocked = 0;
    let totalSkipped = 0;

    for (const bot of botStates) {
      const b = bot as any;
      totalEval += Number(b.entryEvaluationsCount || 0);
      totalOpened += Number(b.entryOpenedCount || 0);
      totalBlocked += Number(b.entryBlockedCount || 0);
      totalSkipped += Number(b.entrySkippedCount || 0);
    }

    // Managed recovery entries from events
    const events = store.events || [];
    const rawManagedRecoveryDeferredEvents = events.filter(
      (e: any) => e.message === "rsi_exit_deferred"
    ).length;
    const managedRecoveryClosedOutcomes = exitManagedRecoveryTotal;
    const managedRecoveryEntries = Math.min(rawManagedRecoveryDeferredEvents, managedRecoveryClosedOutcomes);
    const managedRecoveryUnpairedDeferredEvents = Math.max(rawManagedRecoveryDeferredEvents - managedRecoveryEntries, 0);
    const managedRecoveryOpenDeferredEvents = managedRecoveryUnpairedDeferredEvents;

    // Average hold duration from pipeline snapshots
    let avgHoldMs: number | null = null;
    const pipelines = store.pipelineBySymbol instanceof Map ? Array.from(store.pipelineBySymbol.values()) : [];
    if (pipelines.length > 0) {
      const holdSamples = pipelines
        .map((p: any) => p.average?.totalTickPipelineMs ?? p.tickLatency?.recentWorstTotalMs ?? p.totalPipelineMs)
        .filter((v: number | null | undefined) => v !== null && v !== undefined && v > 0);
      if (holdSamples.length > 0) {
        avgHoldMs = round(holdSamples.reduce((s: number, v: number) => s + v, 0) / holdSamples.length);
      }
    }

    return {
      totalNetPnl: round(totalNetPnl, 2),
      closedTradesCount: totalTrades,
      totalAccountedExits,
      reconciliationError,
      avgNetPnl,
      winRate,
      profitFactor,
      entryEvals: totalEval,
      entryOpened: totalOpened,
      entryBlocked: totalBlocked,
      entrySkipped: totalSkipped,
      managedRecoveryEntries,
      managedRecoveryClosedOutcomes,
      managedRecoveryAvgNetPnl,
      managedRecoveryOpenDeferredEvents,
      managedRecoveryUnpairedDeferredEvents,
      exitNormal,
      exitProtectiveStop,
      exitManagedRecoveryBreaker,
      exitManagedRecoveryTimeout,
      exitManagedRecoveryTarget,
      exitManagedRecoveryInvalidation,
      exitManagedRecoveryProtection,
      exitManagedRecoveryOther,
      exitManagedRecoveryTotal,
      avgHoldPipelineMs: avgHoldMs
    };
  }
}

module.exports = {
  ExperimentReporter
};
