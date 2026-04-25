import type { BotConfig } from "./bot.ts";
import type { BotController, BotDeps } from "./runtime.ts";

export interface BotFactory {
  createBot(config: BotConfig, deps: BotDeps): BotController;
}
