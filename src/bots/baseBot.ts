// Module responsibility: shared bot lifecycle and dependency plumbing for independent bots.

import type { BotConfig } from "../types/bot.ts";
import type { BotDeps } from "../types/runtime.ts";

abstract class BaseBot<TDeps extends BotDeps = BotDeps> {
  config: BotConfig;
  deps: TDeps;
  started: boolean;
  unsubscribe: (() => void) | null;

  constructor(config: BotConfig, deps: TDeps) {
    this.config = config;
    this.deps = deps;
    this.started = false;
    this.unsubscribe = null;
  }

  start() {
    throw new Error("BaseBot.start() must be implemented by subclasses.");
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.started = false;
  }

  pause(reason: string) {
    this.deps.store.updateBotState(this.config.id, {
      pausedReason: reason,
      status: "paused"
    });
  }

  resume() {
    this.deps.store.updateBotState(this.config.id, {
      pausedReason: null,
      status: "running"
    });
  }
}

export type BaseBotInstance<TDeps extends BotDeps = BotDeps> = BaseBot<TDeps>;
export type BaseBotClass<TDeps extends BotDeps = BotDeps> = abstract new (config: BotConfig, deps: TDeps) => BaseBot<TDeps>;

module.exports = {
  BaseBot
};
