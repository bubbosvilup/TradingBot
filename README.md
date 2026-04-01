# TradingBot

TradingBot ora espone una nuova architettura multi-bot modulare in TypeScript-like runtime modules, eseguibili con `node --experimental-strip-types`. L'obiettivo e separare chiaramente orchestrazione, strategie, ruoli di rischio/performance e data streams, evitando un singolo bot monolitico.

## Nuova struttura

```text
src/
  core/
  bots/
  roles/
  strategies/
  engines/
  streams/
  data/
  types/
  ui/
  utils/
legacy/
```

### Core

- `src/core/orchestrator.ts`: controller principale che avvia il sistema.
- `src/core/botManager.ts`: crea e gestisce piu bot indipendenti.
- `src/core/strategyRegistry.ts`: registra e istanzia strategie plug-and-play.
- `src/core/configLoader.ts`: legge i file JSON di configurazione.
- `src/core/wsManager.ts`: connessioni WebSocket, reconnect e normalizzazione eventi market.
- `src/core/stateStore.ts`: single source of truth in memoria per prezzi, bot, posizioni e performance.
- `src/core/systemServer.ts`: API/HTTP minimale per osservabilita e UI.

### Bots

- `src/bots/baseBot.ts`: lifecycle comune.
- `src/bots/tradingBot.ts`: implementazione concreta del bot.

### Roles

- `src/roles/riskManager.ts`: sizing, drawdown, cooldown, overtrading.
- `src/roles/performanceMonitor.ts`: PnL, win rate, drawdown, profit factor.
- `src/roles/strategySwitcher.ts`: switching controllato fra strategie.
- `src/roles/regimeDetector.ts`: regime detector leggero.

### Engines

- `src/engines/indicatorEngine.ts`: EMA, RSI, momentum, volatility.
- `src/engines/executionEngine.ts`: esecuzione simulata ordini/posizioni.
- `src/engines/backtestEngine.ts`: placeholder pronto per replay storici.

### Streams

- `src/streams/marketStream.ts`: market feed unificato con `marketMode: mock | live`.
- `src/streams/userStream.ts`: aggiornamenti ordini/account, pronto per fills e balances.

### Data

- `src/data/bots.config.json`: definizione dei bot indipendenti.
- `src/data/strategies.config.json`: registry delle strategie disponibili.

## Multi-bot config

`src/data/bots.config.json`

```json
{
  "marketMode": "mock",
  "market": {
    "provider": "binance",
    "streamType": "trade",
    "wsBaseUrl": "wss://stream.binance.com:9443",
    "liveEmitIntervalMs": 1000
  },
  "bots": [
    {
      "id": "bot_btc_trend",
      "symbol": "BTC/USDT",
      "strategy": "emaCross",
      "enabled": true,
      "riskProfile": "medium"
    },
    {
      "id": "bot_eth_reversion",
      "symbol": "ETH/USDT",
      "strategy": "rsiReversion",
      "enabled": true,
      "riskProfile": "low"
    }
  ]
}
```

Nel file reale ho aggiunto anche `allowedStrategies` e `initialBalanceUsdt` per supportare lo strategy switching e il paper sizing.

## Strategie disponibili

- `emaCross`: trend following con EMA cross e filtro RSI.
- `rsiReversion`: mean reversion per mercati laterali.
- `breakout`: breakout momentum con range recente.

Ogni strategia espone il contratto standard:

```ts
export interface Strategy {
  id: string;
  evaluate(context: MarketContext): StrategyDecision;
}
```

## Avvio

Compatibilita:

- `npm start`
- `node bot.js`

Entrambi avviano il bootstrap JS che delega a:

```bash
node --experimental-strip-types src/core/orchestrator.ts
```

Per eseguire direttamente l'orchestrator:

```bash
npm run start:orchestrator
```

Per uno smoke rapido:

```bash
node --experimental-strip-types src/core/orchestrator.ts --duration-ms=5000 --summary-ms=1000
```

## Test

```bash
npm test
```

I test ora includono anche uno smoke sul nuovo orchestrator multi-bot.

## Note operative

- Il runtime supporta sia `mock` che `live` via `marketMode` in `src/data/bots.config.json` o `MARKET_MODE` da env.
- In `live`, Binance Spot WebSocket alimenta `marketStream`, che coalesca gli update prima di scriverli nello `stateStore` per evitare event flooding sui bot.
- Le strategie non sono hardcoded nel bot: il bot riceve la strategia dal `strategyRegistry`.
- Il `stateStore` aggiorna lo stato incrementalmente invece di ricostruirlo interamente a ogni tick.
- I moduli JS del sistema precedente sono stati isolati in `legacy/` e non fanno parte del nuovo orchestrator.
