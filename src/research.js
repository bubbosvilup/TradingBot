"use strict";

const { runBacktestJob } = require("./backtest_runner");

function createResearchApi(context) {
  const { config, state } = context;
  const getNowIso = typeof context.getNowIso === "function" ? context.getNowIso : () => new Date().toISOString();
  let activeBacktestPromise = null;

  function ensureResearchState() {
    if (!state.research) {
      state.research = {};
    }
    if (!state.research.backtestJob) {
      state.research.backtestJob = {
        active: false,
        error: null,
        finishedAt: null,
        logs: [],
        progressPct: 0,
        request: null,
        resultSummary: null,
        stage: "idle",
        startedAt: null,
        symbol: null
      };
    }
  }

  function pushLog(message) {
    ensureResearchState();
    state.research.backtestJob.logs = [
      ...(state.research.backtestJob.logs || []),
      { message, time: getNowIso() }
    ].slice(-20);
  }

  function updateJob(patch, message = null) {
    ensureResearchState();
    state.research.backtestJob = {
      ...state.research.backtestJob,
      ...patch
    };
    if (message) {
      pushLog(message);
    }
  }

  function getBacktestJobStatus() {
    ensureResearchState();
    return { ...state.research.backtestJob };
  }

  async function startBacktest(request = {}) {
    ensureResearchState();
    if (activeBacktestPromise) {
      return {
        accepted: false,
        job: getBacktestJobStatus(),
        ok: false,
        reason: "already_running"
      };
    }

    const resolvedRequest = {
      aggressiveMode: typeof request.aggressiveMode === "boolean"
        ? request.aggressiveMode
        : (typeof context.getAggressiveModeEnabled === "function" ? context.getAggressiveModeEnabled() : config.AGGRESSIVE_MODE_ENABLED === true),
      btcFilterEnabled: typeof request.btcFilterEnabled === "boolean" ? request.btcFilterEnabled : config.BACKTEST_BTC_FILTER_ENABLED,
      days: request.days ?? config.BACKTEST_DAYS,
      symbolLimit: request.symbolLimit ?? config.BACKTEST_SYMBOL_LIMIT,
      symbols: request.symbols || "",
      useActiveWatchlist: typeof request.useActiveWatchlist === "boolean" ? request.useActiveWatchlist : true,
      useHotPool: typeof request.useHotPool === "boolean" ? request.useHotPool : true
    };

    updateJob({
      active: true,
      error: null,
      finishedAt: null,
      logs: [],
      progressPct: 0,
      request: resolvedRequest,
      resultSummary: null,
      stage: "queued",
      startedAt: getNowIso(),
      symbol: null
    }, "Backtest avviato dalla dashboard.");

    activeBacktestPromise = (async () => {
      try {
        const report = await runBacktestJob({
          activeSymbols: Array.isArray(state.watchlist?.activeSymbols) ? state.watchlist.activeSymbols : context.getSymbols(),
          baseConfig: config,
          hotPool: Array.isArray(state.watchlist?.hotPool) ? state.watchlist.hotPool : [],
          log: (message) => pushLog(message),
          onProgress: (progress) => {
            updateJob({
              progressPct: progress?.progressPct ?? state.research.backtestJob.progressPct,
              stage: progress?.stage || state.research.backtestJob.stage,
              symbol: progress?.symbol || null
            }, progress?.message || null);
          },
          request: resolvedRequest
        });

        if (context.persistence?.saveBacktestReport) {
          context.persistence.saveBacktestReport(report);
        } else {
          state.research.backtestReport = report;
        }

        updateJob({
          active: false,
          error: null,
          finishedAt: getNowIso(),
          progressPct: 100,
          resultSummary: {
            generatedAt: report.generatedAt,
            recommendedMode: report.recommendedMode,
            symbolCount: report.symbolCount,
            topModePnlUsdt: report.modes?.[0]?.summary?.sessionPnl ?? null
          },
          stage: "completed",
          symbol: null
        }, `Backtest completato. Modalita raccomandata: ${report.recommendedMode || "n/a"}.`);
      } catch (error) {
        updateJob({
          active: false,
          error: error.message,
          finishedAt: getNowIso(),
          stage: "failed",
          symbol: null
        }, `Backtest fallito: ${error.message}`);
      } finally {
        activeBacktestPromise = null;
      }
    })();

    return {
      accepted: true,
      job: getBacktestJobStatus(),
      ok: true
    };
  }

  return {
    getBacktestJobStatus,
    startBacktest
  };
}

module.exports = {
  createResearchApi
};
