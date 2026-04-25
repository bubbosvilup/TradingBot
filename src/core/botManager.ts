import type { BotConfig } from "../types/bot.ts";
import type { BotController, BotDeps } from "../types/runtime.ts";
import type { BotFactory } from "../types/botFactory.ts";

interface BotManagerOptions {
  botFactory: BotFactory;
  deps: BotDeps;
}

class BotManager {
  botFactory: BotFactory;
  deps: BotDeps;
  bots: Map<string, BotController>;

  constructor(options: BotManagerOptions) {
    this.botFactory = options.botFactory;
    this.deps = options.deps;
    this.bots = new Map();
  }

  initialize(botConfigs: BotConfig[]) {
    for (const config of botConfigs) {
      if (!config.enabled) continue;
      this.deps.store.registerBot(config);
      const bot = this.botFactory.createBot(config, this.deps);
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
