// Module responsibility: create, start and manage multiple independent bot instances.

import type { BotConfig } from "../types/bot.ts";

const { TradingBot } = require("../bots/tradingBot.ts");

class BotManager {
  deps: any;
  bots: Map<string, any>;

  constructor(deps: any) {
    this.deps = deps;
    this.bots = new Map();
  }

  initialize(botConfigs: BotConfig[]) {
    for (const config of botConfigs) {
      if (!config.enabled) continue;
      this.deps.store.registerBot(config);
      const bot = new TradingBot(config, this.deps);
      this.bots.set(config.id, bot);
    }
  }

  startAll() {
    for (const bot of this.bots.values()) {
      bot.start();
    }
  }

  stopAll() {
    for (const bot of this.bots.values()) {
      bot.stop();
    }
  }

  pauseBot(botId: string, reason: string) {
    this.bots.get(botId)?.pause(reason);
  }

  resumeBot(botId: string) {
    this.bots.get(botId)?.resume();
  }

  getBots() {
    return Array.from(this.bots.values());
  }
}

module.exports = {
  BotManager
};

