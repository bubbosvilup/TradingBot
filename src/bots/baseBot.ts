// Module responsibility: shared bot lifecycle and dependency plumbing for independent bots.

import type { BotConfig } from "../types/bot.ts";

class BaseBot {
  config: BotConfig;
  deps: any;
  started: boolean;
  unsubscribe: (() => void) | null;

  constructor(config: BotConfig, deps: any) {
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

module.exports = {
  BaseBot
};

