// Module responsibility: load JSON configuration files without mixing them into runtime logic.

import type { BotConfig } from "../types/bot.ts";
import type { MarketStreamConfig, MarketMode } from "../types/market.ts";

const fs = require("node:fs");
const path = require("node:path");

class ConfigLoader {
  rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir || path.resolve(__dirname, "..");
  }

  loadJson(relativePath: string) {
    const absolutePath = path.resolve(this.rootDir, relativePath);
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  }

  loadBotsConfig(): {
    bots: BotConfig[];
    executionMode?: "paper" | "live";
    marketMode?: MarketMode;
    market?: MarketStreamConfig;
  } {
    return this.loadJson("./data/bots.config.json");
  }

  loadStrategiesConfig() {
    return this.loadJson("./data/strategies.config.json");
  }

  resolve(relativePath: string) {
    return path.resolve(this.rootDir, relativePath);
  }
}

module.exports = {
  ConfigLoader
};
