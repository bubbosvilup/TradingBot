// Module responsibility: manage the post-loss architect re-entry latch using the existing bot state store.

import type { BotRuntimeState } from "../types/bot.ts";
import type { BotStateStoreLike } from "../types/runtime.ts";

export interface PostLossArchitectLatchState {
  activatedAt: number | null;
  active: boolean;
  blocking: boolean;
  freshPublishCount: number;
  lastCountedPublishedAt: number | null;
  latestPublishedAt: number | null;
  requiredPublishes: number;
  strategyId: string | null;
}

export interface PostLossArchitectLatchTransition {
  compactMetadata: Record<string, unknown>;
  logMetadata: Record<string, unknown>;
  message: "post_loss_architect_latch_activated" | "post_loss_architect_latch_publish_counted" | "post_loss_architect_latch_released";
}

class PostLossArchitectLatch {
  botId: string;
  symbol: string;
  requiredPublishes: number;
  store: BotStateStoreLike;

  constructor(params: {
    botId: string;
    requiredPublishes: number;
    store: BotStateStoreLike;
    symbol: string;
  }) {
    this.botId = params.botId;
    this.symbol = params.symbol;
    this.requiredPublishes = Math.max(Number(params.requiredPublishes) || 1, 1);
    this.store = params.store;
  }

  getState(activeStrategyId: string, runtimeState?: BotRuntimeState | null): PostLossArchitectLatchState {
    const state = runtimeState || this.store.getBotState(this.botId);
    const publisher = this.store.getArchitectPublisherState(this.symbol);
    const strategyId = state?.postLossArchitectLatchStrategyId || null;
    const active = Boolean(state?.postLossArchitectLatchActive);
    return {
      activatedAt: state?.postLossArchitectLatchActivatedAt || null,
      active,
      blocking: active && Boolean(strategyId) && strategyId === activeStrategyId,
      freshPublishCount: Number(state?.postLossArchitectLatchFreshPublishCount || 0),
      lastCountedPublishedAt: state?.postLossArchitectLatchLastCountedPublishedAt || null,
      latestPublishedAt: publisher?.lastPublishedAt || null,
      requiredPublishes: this.requiredPublishes,
      strategyId
    };
  }

  activateOnLoss(params: {
    closedAt: number;
    netPnl: number;
    strategyId: string;
  }): {
    state: BotRuntimeState | null;
    transition?: PostLossArchitectLatchTransition;
  } {
    if (!(Number(params.netPnl) < 0)) {
      return {
        state: this.store.getBotState(this.botId)
      };
    }

    this.store.updateBotState(this.botId, {
      postLossArchitectLatchActive: true,
      postLossArchitectLatchActivatedAt: params.closedAt,
      postLossArchitectLatchFreshPublishCount: 0,
      postLossArchitectLatchLastCountedPublishedAt: null,
      postLossArchitectLatchStrategyId: params.strategyId
    });

    return {
      state: this.store.getBotState(this.botId),
      transition: {
        compactMetadata: {
          freshPublishCount: 0,
          requiredPublishes: this.requiredPublishes,
          status: "post_loss_architect_latch_activated",
          strategy: params.strategyId
        },
        logMetadata: {
          activatedAt: params.closedAt,
          netPnl: Number(Number(params.netPnl).toFixed(4)),
          requiredPublishes: this.requiredPublishes,
          strategy: params.strategyId
        },
        message: "post_loss_architect_latch_activated"
      }
    };
  }

  refresh(): {
    state: BotRuntimeState | null;
    transition?: PostLossArchitectLatchTransition;
  } {
    const state = this.store.getBotState(this.botId);
    if (!state?.postLossArchitectLatchActive) {
      return { state };
    }

    const activatedAt = Number(state.postLossArchitectLatchActivatedAt || 0);
    const publisher = this.store.getArchitectPublisherState(this.symbol);
    const latestPublishedAt = Number(publisher?.lastPublishedAt || 0);
    const lastCountedPublishedAt = Number(state.postLossArchitectLatchLastCountedPublishedAt || 0);
    if (!Number.isFinite(latestPublishedAt) || latestPublishedAt <= 0 || latestPublishedAt <= activatedAt || latestPublishedAt <= lastCountedPublishedAt) {
      return { state };
    }

    const strategyId = state.postLossArchitectLatchStrategyId || null;
    const freshPublishCount = Number(state.postLossArchitectLatchFreshPublishCount || 0) + 1;
    this.store.updateBotState(this.botId, {
      postLossArchitectLatchFreshPublishCount: freshPublishCount,
      postLossArchitectLatchLastCountedPublishedAt: latestPublishedAt
    });

    if (freshPublishCount < this.requiredPublishes) {
      return {
        state: this.store.getBotState(this.botId),
        transition: {
          compactMetadata: {
            freshPublishCount,
            lastPublishedAt: latestPublishedAt,
            requiredPublishes: this.requiredPublishes,
            status: "post_loss_architect_latch_publish_counted",
            strategy: strategyId
          },
          logMetadata: {
            freshPublishCount,
            lastPublishedAt: latestPublishedAt,
            requiredPublishes: this.requiredPublishes,
            strategy: strategyId
          },
          message: "post_loss_architect_latch_publish_counted"
        }
      };
    }

    this.store.updateBotState(this.botId, {
      postLossArchitectLatchActive: false,
      postLossArchitectLatchActivatedAt: null,
      postLossArchitectLatchFreshPublishCount: freshPublishCount,
      postLossArchitectLatchLastCountedPublishedAt: latestPublishedAt,
      postLossArchitectLatchStrategyId: null
    });

    return {
      state: this.store.getBotState(this.botId),
      transition: {
        compactMetadata: {
          freshPublishCount,
          lastPublishedAt: latestPublishedAt,
          requiredPublishes: this.requiredPublishes,
          status: "post_loss_architect_latch_released",
          strategy: strategyId
        },
        logMetadata: {
          freshPublishCount,
          lastPublishedAt: latestPublishedAt,
          requiredPublishes: this.requiredPublishes,
          strategy: strategyId
        },
        message: "post_loss_architect_latch_released"
      }
    };
  }
}

module.exports = {
  PostLossArchitectLatch
};
