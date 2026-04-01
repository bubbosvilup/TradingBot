# TradingBot

TradingBot e un runtime multi-bot modulare per paper trading e osservabilita realtime.

Lo stato attuale del progetto e questo:
- architettura nuova multi-bot attiva
- feed market `mock` o `live` via Binance WebSocket
- `stateStore` come fonte unica di verita
- layer `Context -> Architect -> TradingBot`
- UI/API minima per osservare bot, prezzi, posizioni, eventi e storico trade
- esecuzione ancora simulata / paper, non ordini reali su exchange

## Stato del sistema

Flusso dati attuale:

```text
Binance/mock feed
  -> streams
  -> stateStore
  -> ContextService
  -> ArchitectService
  -> TradingBot
  -> executionEngine
  -> UI/API
```

Principi chiave:
- i bot non leggono direttamente Binance
- la UI non legge direttamente gli stream
- il market regime non e deciso dentro il bot esecutivo
- le decisioni pubblicate dall'Architect sono separate dalle osservazioni rumorose per-tick

## Cosa fa oggi

- Avvia piu bot indipendenti in parallelo
- Riceve prezzi realtime via Binance Spot WebSocket in `live`
- Usa un feed simulato in `mock`
- Mantiene prezzi, posizioni, ordini, performance ed eventi nello `stateStore`
- Prepara feature rolling interpretabili per simbolo
- Classifica il mercato in:
  - `trend`
  - `range`
  - `volatile`
  - `unclear`
- Mappa il regime a una famiglia strategica:
  - `trend -> trend_following`
  - `range -> mean_reversion`
  - `volatile -> no_trade`
  - `unclear -> no_trade`
- Pubblica una decisione Architect stabile ogni 30 secondi
- Riallinea i bot alla famiglia pubblicata solo quando sono flat
- Mantiene aperte le posizioni esistenti anche se il regime cambia
- Espone dashboard e API di osservabilita

## Cosa NON fa ancora

- Non esegue ordini reali su Binance
- Non garantisce profittabilita
- Non usa ancora grid bot
- Non usa ancora una famiglia `breakout` come strategia esecutiva attiva
- Non e ancora una piattaforma di trading completa tipo terminale professionale

Nota importante:
- il feed puo essere `live`
- l'execution resta `paper`

## Struttura

```text
src/
  core/
    orchestrator.ts
    botManager.ts
    configLoader.ts
    stateStore.ts
    strategyRegistry.ts
    systemServer.ts
    wsManager.ts
    contextService.ts
    architectService.ts
  bots/
    baseBot.ts
    tradingBot.ts
  roles/
    contextBuilder.ts
    botArchitect.ts
    performanceMonitor.ts
    regimeDetector.ts
    riskManager.ts
    strategySwitcher.ts
  engines/
    indicatorEngine.ts
    executionEngine.ts
    backtestEngine.ts
  streams/
    marketStream.ts
    userStream.ts
  strategies/
    emaCross/
    rsiReversion/
    breakout/
  data/
    bots.config.json
    strategies.config.json
  types/
  ui/
  utils/

public/
legacy/
tests/
```

## Componenti principali

### Core

- `src/core/orchestrator.ts`: bootstrap del sistema
- `src/core/stateStore.ts`: stato centrale in memoria
- `src/core/systemServer.ts`: API e server della dashboard
- `src/core/wsManager.ts`: gestione WebSocket e reconnect
- `src/core/contextService.ts`: costruisce il contesto rolling per simbolo
- `src/core/architectService.ts`: pubblica il regime/famiglia consigliata su cadenza stabile

### Execution

- `src/bots/tradingBot.ts`: bot esecutivo per simbolo
- `src/roles/riskManager.ts`: sizing, cooldown, drawdown, guardrail
- `src/roles/performanceMonitor.ts`: PnL, drawdown, win rate, profit factor
- `src/roles/strategySwitcher.ts`: resolver leggero famiglia -> strategia eseguibile
- `src/engines/executionEngine.ts`: paper execution

### Context / Architect

- `src/roles/contextBuilder.ts`: feature engineering rolling
- `src/roles/botArchitect.ts`: classificatore di regime, non esecutivo

Feature principali oggi:
- directional efficiency
- ema separation
- slope consistency
- reversion stretch
- rsi intensity
- volatility risk
- chopiness
- breakout quality
- data quality
- maturity

### Streams

- `src/streams/marketStream.ts`: feed unificato `mock | live`
- `src/streams/userStream.ts`: eventi ordini/account, pronto per evoluzioni live

## Strategie eseguibili oggi

Famiglie attive:
- `trend_following -> emaCross`
- `mean_reversion -> rsiReversion`

Strategie presenti nel repo:
- `emaCross`
- `rsiReversion`
- `breakout`

Importante:
- `breakout` esiste nel codice
- al momento non e usata come famiglia esecutiva attiva dal flow Architect -> Switcher

## Configurazione bot

File: `src/data/bots.config.json`

Esempio:

```json
{
  "marketMode": "mock",
  "market": {
    "provider": "binance",
    "streamType": "trade",
    "wsBaseUrl": "wss://stream.binance.com:9443",
    "klineIntervals": ["1m", "5m", "1h"],
    "liveEmitIntervalMs": 1000,
    "mockIntervalMs": 1000
  },
  "bots": [
    {
      "id": "bot_btc_trend",
      "symbol": "BTC/USDT",
      "strategy": "emaCross",
      "enabled": true,
      "riskProfile": "medium",
      "allowedStrategies": ["emaCross", "breakout", "rsiReversion"],
      "initialBalanceUsdt": 1000
    }
  ]
}
```

Override rapido:
- `MARKET_MODE=mock`
- `MARKET_MODE=live`

## Warm-up e publish Architect

Regole attuali:
- warm-up context: 30 secondi
- osservazione continua
- publish Architect ogni 30 secondi
- decisione pubblicata stabile fino al ciclo successivo
- hysteresis + challenger persistence per evitare flap

Il bot esecutivo:
- legge solo lo stato published dell'Architect
- non cambia famiglia mentre ha una posizione aperta
- si riallinea quando torna flat
- non chiude una posizione solo perche il regime cambia

## UI / API

Avviando il bot, il server espone una dashboard locale.

Endpoint principali:
- `GET /api/system`
- `GET /api/bots`
- `GET /api/prices`
- `GET /api/positions`
- `GET /api/events`
- `GET /api/trades`
- `GET /api/chart`
- `GET /api/analytics`

La UI mostra:
- bot attivi
- stato stream
- latenza pipeline
- focus symbol
- posizioni aperte
- trade history in modale
- chart locale con marker di esecuzione
- eventi recenti

## Avvio

Standard:

```bash
npm start
```

Diretto:

```bash
npm run start:orchestrator
```

Smoke rapido:

```bash
node --experimental-strip-types src/core/orchestrator.ts --duration-ms=5000 --summary-ms=1000
```

## Test

```bash
npm test
```

La suite copre anche:
- orchestrator
- market stream
- ws manager
- context service
- architect service
- strategy switcher
- trading bot
- system server

## Legacy

Il codice precedente e stato isolato in `legacy/`.

Non fa parte del nuovo runtime principale.
