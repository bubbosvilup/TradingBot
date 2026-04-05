# TradingBot

Runtime multi-bot modulare per **paper trading** e **osservabilità realtime** su mercati Spot.

## Architettura

Il sistema segue un flusso decisionale stratificato:

```
Binance/mock feed
  -> streams
  -> stateStore (fonte unica di verità in memoria)
  -> ContextService     (feature engineering rolling)
  -> ArchitectService   (regime classification e family routing)
  -> TradingBot         (orchestrazione entry/exit/execution)
  -> executionEngine    (paper execution)
  -> UI/API             (dashboard e observability)
```

Principi chiave:
- **Context informa** — costruisce indicatori e feature rolling per simbolo
- **Architect decide** — classifica il regime e pubblica la famiglia strategica consigliata
- **TradingBot orchestra** — coordina entry, exit e execution entro il perimetro Architect
- **Coordinatori dedicati** — gestiscono flussi locali (entry gate, open attempt, exit outcome, latch post-loss, telemetry)

Vincoli preservati:
- I bot non leggono direttamente Binance
- La UI non legge direttamente gli stream
- Il market regime non è deciso dentro il bot esecutivo
- Le decisioni Architect sono separate dal rumore per-tick
- Il routing strategico dipende dal family state pubblicato, non da switch hardcoded

## Stato operativo

| Aspetto            | Stato                |
|--------------------|----------------------|
| Architettura       | Multi-bot attiva     |
| Feed market        | `mock` o `live` (Binance WebSocket) |
| Execution mode     | Solo `paper` (nessun ordine reale) |
| State store        | In-memory, fonte unica di verità |
| UI / API           | Dashboard locale con dati bot, prezzi, posizioni, eventi, trade history |
| Backtest           | Legacy engine disponibile |

## Cosa fa oggi

- Avvia **più bot indipendenti** in parallelo
- Riceve prezzi realtime via Binance Spot WebSocket in modalità `live`
- Usa un feed simulato in modalità `mock`
- Mantiene prezzi, posizioni, ordini, performance ed eventi nello `stateStore`
- Classifica il mercato in `trend`, `range`, `volatile`, `unclear`
- Mappa il regime a una famiglia strategica:
  - `trend` → `trend_following`
  - `range` → `mean_reversion`
  - `volatile` → `no_trade`
  - `unclear` → `no_trade`
- Pubblica una decisione Architect stabile ogni ~30 secondi
- Riallinea i bot alla famiglia pubblicata solo quando sono flat
- Mantieni le posizioni aperte anche se il regime cambia
- Gestisce exit policy strutturate con lifecycle esplicito per posizione
- Supporta **managed recovery** per mean reversion dopo RSI exit deboli
- Applica **post-loss Architect latch** basato sui publish fresh dell'Architect
- Registra lifecycle, close classification, close reason e timing di uscita
- Espone dashboard e API di osservabilità

## Cosa NON fa ancora

- ❌ Non esegue ordini reali su Binance
- ❌ Non garantisce profittabilità
- ❌ Non è un terminale professionale
- ❌ La famiglia `breakout` non è ancora instradata nel flow Architect standard

> **Nota di sicurezza:** anche con `MARKET_MODE=live`, il sistema esegue solo paper trading. Se viene richiesto `EXECUTION_MODE=live`, il runtime forza `paper` e lo dichiara nei log.

## Exit Architecture

Le posizioni transitano attraverso stati runtime espliciti:

```
ACTIVE → MANAGED_RECOVERY → EXITING → CLOSED
```

Eventi lifecycle:
| Evento                   | Descrizione                              |
|--------------------------|------------------------------------------|
| `RSI_EXIT_HIT`           | Segnale RSI di uscita attivato           |
| `PRICE_TARGET_HIT`       | Target di prezzo raggiunto               |
| `REGIME_INVALIDATION`    | Il contesto Architect invalida la tesi   |
| `PROTECTIVE_STOP_HIT`    | Stop protettivo della posizione          |
| `RECOVERY_TIMEOUT`       | Timeout del managed recovery             |
| `FAILED_RSI_EXIT`        | RSI exit che chiude in negativo          |

Meccanismi di uscita distinti:
| Meccanismo        | Quando si attiva                                  |
|-------------------|---------------------------------------------------|
| `qualification`   | Uscita guidata dal segnale (es. RSI exit confermato) |
| `recovery`        | Posizione in managed recovery, chiude su target/timeout |
| `protection`      | Uscita difensiva su soglie rischio/posizione      |
| `invalidation`    | Uscita per morte della tesi (Architect context)   |

Per `rsiReversion` il flow è:
1. L'RSI exit viene qualificato economicamente
2. Se il net PnL stimato non basta → entra in **managed recovery**
3. In managed recovery l'RSI viene ignorato come trigger
4. Chiusura solo tramite: target recovery, invalidation, protective stop, o timeout

Target recovery supportati: `emaSlow`, `emaBaseline`, `sma20`, `entryPrice`

## PnL dei trade chiusi

Il PnL è calcolato nel layer di execution:

```
entryNotionalUsdt = entryPrice × quantity
exitNotionalUsdt  = exitPrice × quantity
grossPnl          = (exitPrice - entryPrice) × quantity
fees              = (entryNotionalUsdt + exitNotionalUsdt) × feeRate
netPnl            = grossPnl - fees
```

Il `feeRate` ha una sola fonte di verità: risolto a monte e iniettato nell'`ExecutionEngine`.

## Strategie

Famiglie attive di default:
| Famiglia             | Strategia        |
|----------------------|------------------|
| `trend_following`    | `emaCross`       |
| `mean_reversion`     | `rsiReversion`   |

Strategie presenti nel repo:
| Strategia        | Famiglia             | Routing Architect |
|------------------|----------------------|-------------------|
| `emaCross`       | `trend_following`    | ✅                |
| `rsiReversion`   | `mean_reversion`     | ✅                |
| `breakout`       | (configurabile)      | ⚠️ non instradata |

## Logging

Variabile: `LOG_TYPE=verbose|minimal|only_trades|strategy_debug`

| Modalità         | Contenuto                                    |
|------------------|----------------------------------------------|
| `verbose`        | Output completo                              |
| `minimal`        | Solo eventi runtime essenziali               |
| `only_trades`    | Solo open/close/PnL e warning/error          |
| `strategy_debug` | Setup, Buy, Sell, Block/Risk/Architect change |

## Configurazione

File: `src/data/bots.config.json`

```json
{
  "executionMode": "paper",
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
      "allowedStrategies": ["emaCross", "rsiReversion", "breakout"],
      "initialBalanceUsdt": 1000
    }
  ]
}
```

Override via environment:
```bash
MARKET_MODE=mock          # o live
EXECUTION_MODE=paper      # sempre paper
```

## Struttura

```
src/
  core/                         # Moduli core del runtime
    orchestrator.ts             # Bootstrap del sistema
    botManager.ts               # Gestione ciclo di vita bot
    configLoader.ts             # Caricamento configurazione
    stateStore.ts               # Stato centrale in memoria
    strategyRegistry.ts         # Registry delle strategie
    systemServer.ts             # API HTTP e server dashboard
    wsManager.ts                # Gestione WebSocket e reconnect
    contextService.ts           # Costruisce contesto rolling per simbolo
    architectService.ts         # Pubblica regime/famiglia consigliata
  bots/                         # Implementazione bot
    baseBot.ts                  # Classe base per tutti i bot
    tradingBot.ts               # Bot esecutivo principale
  roles/                        # Coordinatori e ruoli dedicati
    contextBuilder.ts           # Feature engineering rolling
    botArchitect.ts             # Classificatore di regime (non esecutivo)
    performanceMonitor.ts       # PnL, drawdown, win rate, profit factor
    regimeDetector.ts           # Rilevamento regime di mercato
    riskManager.ts              # Sizing, cooldown, drawdown, guardrail
    strategySwitcher.ts         # Resolver famiglia → strategia
    architectCoordinator.ts     # Sync / usability / apply Architect
    entryEconomicsEstimator.ts  # Edge formulas strategy-specific entry
    entryCoordinator.ts         # Entry gating e signal state
    openAttemptCoordinator.ts   # Open attempt e execution rejection
    entryOutcomeCoordinator.ts  # Final entry outcome shaping
    exitOutcomeCoordinator.ts   # Final close outcome shaping
    exitDecisionCoordinator.ts  # Exit decision planning
    postLossArchitectLatch.ts   # Post-loss re-entry defense
    positionLifecycleManager.ts # Stati e transizioni posizioni
    recoveryTargetResolver.ts   # Resolver target di recovery
    exitPolicyRegistry.ts       # Nome exit policy strutturate
    tradingBotTelemetry.ts      # Metadata shaping per log/diagnostica
  engines/
    indicatorEngine.ts          # Calcolo indicatori tecnici
    executionEngine.ts          # Paper execution
    backtestEngine.ts           # Backtest engine
  streams/
    marketStream.ts             # Feed unificato mock | live
    userStream.ts               # Eventi ordini/account
  strategies/
    emaCross/                   # Trend following
    rsiReversion/               # Mean reversion
    breakout/                   # Breakout (presente, non instradata di default)
  data/
    bots.config.json            # Configurazione bot
    strategies.config.json      # Configurazione strategie
  types/                        # Definizione TypeScript types
  ui/                           # Componenti UI
  utils/                        # Utilities

public/                         # Frontend statico (dashboard)
legacy/                         # Codice precedente (non parte del runtime principale)
tests/                          # Test suite
```

## Componenti principali

### Core
| Modulo                  | Responsabilità                              |
|-------------------------|---------------------------------------------|
| `orchestrator.ts`       | Bootstrap e avvio del sistema               |
| `stateStore.ts`         | Stato centrale in-memory (Map-based)        |
| `systemServer.ts`       | API HTTP + server dashboard                 |
| `wsManager.ts`          | WebSocket, heartbeat, reconnect             |
| `contextService.ts`     | Contesto rolling per simbolo                |
| `architectService.ts`   | Publish Architect decision (30s cadence)    |

### Bot & Coordinatori
| Modulo                          | Responsabilità                           |
|---------------------------------|------------------------------------------|
| `tradingBot.ts`                 | Orchestratore entry/exit/execution       |
| `architectCoordinator.ts`       | Sync e apply della decisione Architect   |
| `entryCoordinator.ts`           | Entry gating, signal streak              |
| `openAttemptCoordinator.ts`     | Sizing e open attempt                    |
| `entryOutcomeCoordinator.ts`    | Final entry outcome shaping              |
| `exitOutcomeCoordinator.ts`     | Close trade outcome shaping              |
| `postLossArchitectLatch.ts`     | Latch post-loss basato su publish fresh  |
| `positionLifecycleManager.ts`   | Stati e transizioni posizioni            |
| `tradingBotTelemetry.ts`        | Metadata log strutturato                 |

### Risk & Performance
| Modulo                          | Responsabilità                           |
|---------------------------------|------------------------------------------|
| `riskManager.ts`                | Sizing, cooldown, drawdown, loss streak  |
| `performanceMonitor.ts`         | PnL, drawdown, win rate, profit factor   |
| `exitPolicyRegistry.ts`         | Exit policy nominate                     |
| `recoveryTargetResolver.ts`     | Target simbolici recovery                |

## Avvio

Standard:
```bash
npm start
```

Realtime + paper execution:
```bash
MARKET_MODE=live EXECUTION_MODE=paper npm start
```

Smoke test rapido:
```bash
node --experimental-strip-types src/core/orchestrator.ts --duration-ms=5000 --summary-ms=1000
```

## Test

```bash
npm test
```

La suite copre:
- orchestrator
- market stream / ws manager
- context / architect service
- strategy switcher
- trading bot
- system server
- exit policy / recovery target resolver
- position lifecycle manager
- entry / exit coordinators
- state store
- trade constraints
- logging runtime
- runtime

## UI / API

Avviando il bot, la dashboard è accessibile su `http://localhost:<port>` (porta stampata in console).

Endpoint principali:
| Endpoint              | Contenuto                        |
|-----------------------|----------------------------------|
| `GET /api/system`     | Snapshot completo del sistema    |
| `GET /api/bots`       | Stato di tutti i bot             |
| `GET /api/prices`     | Ultimi prezzi                    |
| `GET /api/positions`  | Posizioni aperte                 |
| `GET /api/events`     | Eventi recenti                   |
| `GET /api/trades`     | Storico trade                    |
| `GET /api/analytics`  | Metriche analitiche              |

La dashboard mostra: bot attivi, market mode, stato stream, latenza pipeline, focus symbol, posizioni aperte, trade history, eventi recenti.

## Pipeline Latency

Il sistema traccia la latenza end-to-end del tick pipeline, scomposta in fasi:
- **exchangeToReceive**: tempo network Binance → client
- **receiveToState**: tempo ingresso WebSocket → stateStore update
- **stateToBot**: tempo stateStore → bot evaluation
- **botToExecution**: tempo decisione → execution attempt

Ogni fase ha metriche `average`, `last`, `max` e `recentWorstTotalMs` (peggiore ultimi 20 tick).

## Warm-up e Architect

| Parametro           | Valore       |
|---------------------|--------------|
| Warm-up context     | 30 secondi   |
| Publish Architect   | ~30 secondi  |
| Hysteresis          | Sì (previene flap) |
| Challenger persist. | Sì           |

Il bot esecutivo:
- Legge solo lo stato **published** dell'Architect
- Non cambia famiglia con una posizione aperta
- Si riallinea quando torna flat
- Non chiude posizioni per cambio regime

## Legacy

Il codice precedente è isolato in `legacy/` e non fa parte del nuovo runtime principale.

Per i test di backtest storici, è disponibile `scripts/backtest.js` (basato sul legacy engine).