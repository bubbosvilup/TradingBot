import type { BotConfig } from "../types/bot.ts";
import type { BotController, BotDeps } from "../types/runtime.ts";

const { TradingBot } = require("../bots/tradingBot.ts") as {
  TradingBot: new (config: BotConfig, deps: BotDeps) => BotController;
};

class BotManager {
  deps: BotDeps;
  bots: Map<string, BotController>;

  constructor(deps: BotDeps) {
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
}

module.exports = {
  BotManager
};
