"use strict";

function runBotManagerTests() {
  const { BotManager } = require("../src/core/botManager.ts");
  const registered = [];
  const created = [];
  const started = [];
  const stopped = [];
  const deps = {
    store: {
      registerBot(config) {
        registered.push(config.id);
      }
    }
  };
  const botFactory = {
    createBot(config, receivedDeps) {
      created.push({ config, deps: receivedDeps });
      return {
        start() {
          started.push(config.id);
        },
        stop() {
          stopped.push(config.id);
        }
      };
    }
  };
  const enabledConfig = {
    enabled: true,
    id: "bot_factory_enabled",
    riskProfile: "medium",
    strategy: "rsiReversion",
    symbol: "BTC/USDT"
  };
  const disabledConfig = {
    enabled: false,
    id: "bot_factory_disabled",
    riskProfile: "medium",
    strategy: "rsiReversion",
    symbol: "ETH/USDT"
  };

  const manager = new BotManager({ botFactory, deps });
  manager.initialize([enabledConfig, disabledConfig]);
  manager.startAll();
  manager.stopAll();

  if (registered.length !== 1 || registered[0] !== "bot_factory_enabled") {
    throw new Error(`BotManager should register only enabled bots before factory creation: ${JSON.stringify(registered)}`);
  }
  if (created.length !== 1 || created[0].config !== enabledConfig || created[0].deps !== deps) {
    throw new Error(`BotManager should create enabled bots with injected factory and original deps: ${JSON.stringify(created)}`);
  }
  if (!manager.bots.has("bot_factory_enabled") || manager.bots.has("bot_factory_disabled")) {
    throw new Error("BotManager should store factory-created bots by enabled config id only");
  }
  if (started.join(",") !== "bot_factory_enabled" || stopped.join(",") !== "bot_factory_enabled") {
    throw new Error(`BotManager should preserve start/stop behavior for factory-created bots: ${JSON.stringify({ started, stopped })}`);
  }
}

module.exports = {
  runBotManagerTests
};
