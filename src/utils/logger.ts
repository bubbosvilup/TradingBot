// Module responsibility: scoped console logger with consistent formatting.

import type { BotConfig } from "../types/bot.ts";

function createLogger(scope: string, options: { eventSink?: ((event: any) => void) | null } = {}) {
  function emit(level: string, message: string, metadata?: Record<string, unknown>) {
    const time = Date.now();
    const suffix = metadata && Object.keys(metadata).length > 0
      ? ` | ${Object.entries(metadata).map(([key, value]) => `${key}=${String(value)}`).join(" | ")}`
      : "";
    console.log(`[${new Date(time).toISOString()}] ${scope} | ${level} | ${message}${suffix}`);
    if (typeof options.eventSink === "function" && message !== "heartbeat") {
      options.eventSink({
        id: `${time}-${Math.random().toString(16).slice(2, 8)}`,
        level,
        message,
        metadata: metadata || {},
        scope,
        time
      });
    }
  }

  return {
    child(childScope: string) {
      return createLogger(`${scope}:${childScope}`, options);
    },
    info(message: string, metadata?: Record<string, unknown>) {
      emit("INFO", message, metadata);
    },
    warn(message: string, metadata?: Record<string, unknown>) {
      emit("WARN", message, metadata);
    },
    error(message: string, metadata?: Record<string, unknown>) {
      emit("ERROR", message, metadata);
    },
    bot(botConfig: BotConfig, message: string, metadata?: Record<string, unknown>) {
      emit("BOT", message, { botId: botConfig.id, symbol: botConfig.symbol, ...metadata });
    }
  };
}

module.exports = {
  createLogger
};
