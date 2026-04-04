# TradingBot
## Aggiornamento di oggi

Refactor principale della sessione:

`refactor(trading): slim TradingBot by extracting coordination roles and stabilizing TS foundation`

Cosa e stato completato:
- pulizia e consolidamento di `tsconfig` e del foundation typing per runtime ibrido TypeScript/CommonJS
- tipizzazione di `BaseBot` e `BotDeps`, con rimozione del fallout TypeScript su `TradingBot`
- rimozione di dead code sicuro e di alcuni campi/chart path runtime obsoleti
- refactor del tick flow di `TradingBot` attorno a snapshot immutabile e fasi esplicite
- estrazione della logica strategy-specific di entry economics fuori da `TradingBot`
- estrazione del post-loss Architect latch in un role dedicato
- estrazione della coordinazione Architect in un role dedicato
- estrazione della costruzione metadata per telemetry/logging in un role dedicato
- estrazione della coordinazione entry, open attempt e final entry outcome
- estrazione della coordinazione exit outcome / close-flow

Vincoli preservati durante il refactor:
- comportamento runtime preservato
- semantiche di lifecycle preservate
- managed recovery non ridisegnato
- semantiche di risk ed execution preservate
- log e campi operator-facing preservati
- `tsc` pulito
- test suite pulita

Nuovi ruoli introdotti per alleggerire `TradingBot`:
- `src/roles/entryEconomicsEstimator.ts`
- `src/roles/postLossArchitectLatch.ts`
- `src/roles/architectCoordinator.ts`
- `src/roles/tradingBotTelemetry.ts`
- `src/roles/entryCoordinator.ts`
- `src/roles/openAttemptCoordinator.ts`
- `src/roles/entryOutcomeCoordinator.ts`
- `src/roles/exitOutcomeCoordinator.ts`

Stato attuale dopo la sessione:
- `TradingBot` e piu sottile e piu orientato a orchestrazione top-level
- le regole locali sono state spostate in coordinator/role dedicati
- il runtime resta intenzionalmente `paper` anche con feed `live`
- l'architettura visibile resta:
  - Context informa
  - Architect decide il perimetro
  - TradingBot orchestra
  - ruoli dedicati gestiscono i flow locali

TradingBot e un runtime multi-bot modulare per paper trading e osservabilita realtime.

Lo stato attuale del progetto e questo:
- architettura multi-bot attiva
- feed market `mock` o `live` via Binance WebSocket
- execution mode separato e mantenuto su `paper`
- `stateStore` come fonte unica di verita
- layer `Context -> Architect -> TradingBot`
- UI/API minima per osservare bot, prezzi, posizioni, eventi e storico trade
- esecuzione ancora simulata / paper, non ordini reali su exchange

## Novita recenti

L'ultima fase di lavoro ha consolidato soprattutto architettura, typing foundation, coordinazione entry/exit e observability:

- foundation TypeScript stabilizzato per runtime ibrido TS/CommonJS
- `TradingBot` alleggerito tramite estrazione di coordinator/role dedicati
- tick flow rifattorizzato attorno a snapshot per-tick e fasi esplicite
- `entry economics` strategy-specific spostato fuori dal bot
- coordinazione Architect e post-loss latch spostate fuori dal bot
- metadata di telemetry/logging spostati in un owner dedicato
- coordinazione entry/open/outcome ed exit outcome separate dal bot
- PnL dei trade chiusi normalizzato e loggato in modo esplicito
- `rsiReversion` separata tra exit qualification e managed recovery
- `failed_rsi_exit` classificato in modo esplicito quando un exit RSI chiude in negativo
- post-loss Architect latch basato su publish fresh dell'Architect, non solo su tempo
- `ExitPolicy` nominati con blocchi `qualification / recovery / protection / invalidation`
- recovery target resolver condiviso per target simbolici come `emaSlow`, `emaBaseline`, `sma20`, `entryPrice`
- lifecycle runtime tipizzato per le posizioni:
  - `ACTIVE`
  - `MANAGED_RECOVERY`
  - `EXITING`
  - `CLOSED`
- separazione esplicita tra meccanismi di uscita:
  - `qualification`
  - `recovery`
  - `protection`
  - `invalidation`
- logging runtime piu compatto e orientato a decisioni reali
- utility di analisi/report per misurare gli outcome del nuovo exit system

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
- il routing strategico dipende dal family state pubblicato, non da switch hardcoded in strategy

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
- Gestisce exit policy strutturate per la strategia attiva
- Supporta managed recovery per mean reversion dopo RSI exit deboli
- Applica latch post-loss su publish fresh dell'Architect prima del re-entry
- Registra lifecycle, close classification, close reason e timing di uscita
- Espone dashboard e API di osservabilita

## Cosa NON fa ancora

- Non esegue ordini reali su Binance
- Non garantisce profittabilita
- Non e ancora una piattaforma di trading completa tipo terminale professionale
- Non usa ancora una famiglia Architect dedicata `breakout` nel flow standard di default

Nota importante:
- il feed puo essere `live`
- l'execution resta `paper`
- il runtime attivo non usa order routing reale verso Binance

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
    architectCoordinator.ts
    entryEconomicsEstimator.ts
    entryCoordinator.ts
    openAttemptCoordinator.ts
    entryOutcomeCoordinator.ts
    exitOutcomeCoordinator.ts
    postLossArchitectLatch.ts
    positionLifecycleManager.ts
    recoveryTargetResolver.ts
    exitPolicyRegistry.ts
    tradingBotTelemetry.ts
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
- `src/roles/positionLifecycleManager.ts`: stato runtime e transizioni delle posizioni
- `src/roles/recoveryTargetResolver.ts`: resolver condiviso del target di recovery
- `src/roles/exitPolicyRegistry.ts`: policy nominate per l'exit system
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

Famiglie attive di default:
- `trend_following -> emaCross`
- `mean_reversion -> rsiReversion`

Strategie presenti nel repo:
- `emaCross`
- `rsiReversion`
- `breakout`

Importante:
- `breakout` esiste nel codice
- il routing famiglia -> strategia e config-driven, non piu hardcoded
- `breakout` puo essere instradata se configurata con una famiglia valida
- il flow Architect attivo standard continua a usare soprattutto:
  - `trend_following -> emaCross`
  - `mean_reversion -> rsiReversion`

## Configurazione bot

File: `src/data/bots.config.json`

Esempio:

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
      "allowedStrategies": ["emaCross", "breakout", "rsiReversion"],
      "initialBalanceUsdt": 1000
    }
  ]
}
```

Override rapido:
- `MARKET_MODE=mock`
- `MARKET_MODE=live`
- `EXECUTION_MODE=paper`

Modalita operative supportate oggi:
- `MARKET_MODE=mock` + `EXECUTION_MODE=paper`
- `MARKET_MODE=live` + `EXECUTION_MODE=paper`

Nota di sicurezza:
- anche con `MARKET_MODE=live`, il sistema continua a fare solo paper execution
- se viene richiesto `EXECUTION_MODE=live`, il runtime forza comunque `paper` e lo dichiara nei log

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

## Exit architecture

Per le strategie che usano il nuovo flow, l'uscita non e piu un singolo if sparso ma un lifecycle esplicito.

Stati runtime della posizione:
- `ACTIVE`
- `MANAGED_RECOVERY`
- `EXITING`
- `CLOSED`

Eventi lifecycle principali:
- `RSI_EXIT_HIT`
- `PRICE_TARGET_HIT`
- `REGIME_INVALIDATION`
- `PROTECTIVE_STOP_HIT`
- `RECOVERY_TIMEOUT`
- `FAILED_RSI_EXIT`

Reason code runtime principali:
- `rsi_exit_confirmed`
- `rsi_exit_deferred`
- `reversion_price_target_hit`
- `regime_invalidation_exit`
- `protective_stop_exit`
- `time_exhaustion_exit`

Meccanismi di uscita distinti:
- `qualification`: l'uscita e guidata dal segnale di qualification, ad esempio RSI exit confermato
- `recovery`: la posizione e gia in managed recovery e chiude su target o timeout
- `protection`: uscita difensiva su cordone di rischio/price legato alla posizione
- `invalidation`: uscita per morte della tesi, guidata dal contesto Architect

Distinzione concettuale:
- `protection` = soglie di prezzo/rischio della posizione
- `invalidation` = eventi di contesto che invalidano la tesi

## ExitPolicy e recovery

Le policy di uscita sono strutturate in blocchi:
- `qualification`
- `recovery`
- `protection`
- `invalidation`

Per `rsiReversion`, il comportamento attuale e:
- l'RSI exit viene prima qualificato economicamente
- se il net PnL stimato non basta, la posizione entra in `managed recovery`
- in managed recovery l'RSI viene ignorato come trigger di esecuzione
- la chiusura puo avvenire solo tramite:
  - target di recovery
  - invalidation
  - protective stop
  - timeout

Target di recovery attualmente supportati:
- `emaSlow`
- `emaBaseline`
- `sma20`
- `entryPrice`

## PnL dei trade chiusi

Il PnL dei trade chiusi viene calcolato nel layer di execution ed e la fonte di verita per gli outcome.

Formula attuale:

```text
entryNotionalUsdt = entryPrice * quantity
exitNotionalUsdt = exitPrice * quantity
grossPnl = (exitPrice - entryPrice) * quantity
fees = (entryNotionalUsdt + exitNotionalUsdt) * feeRate
netPnl = grossPnl - fees
```

Il `feeRate` ha una sola fonte di verita: viene risolto a monte e iniettato nell'`ExecutionEngine`.

## Logging runtime

Variabile supportata:

```env
LOG_TYPE=verbose|minimal|only_trades|strategy_debug
```

Modalita:
- `verbose`: mantiene il comportamento piu completo
- `minimal`: solo eventi runtime essenziali
- `only_trades`: solo open/close/PnL e warning/error
- `strategy_debug`: solo eventi ad alto valore per tuning di entry/exit

`strategy_debug` e la modalita piu utile per osservare:
- `SETUP`
- `BUY`
- `SELL`
- `BLOCK_CHANGE`
- `RISK_CHANGE`
- `ARCHITECT_CHANGE`

Con telemetry strutturato su:
- `policyId`
- `positionStatus`
- `exitEvent`
- `exitMechanism`
- `closeReason`
- `closeClassification`
- `grossPnl`
- `fees`
- `netPnl`
- `targetPrice`
- `invalidationLevel`
- `stopLevel`
- `signalTimestamp`
- `executionTimestamp`
- `signalToExecutionMs`

## Analisi degli exit

E presente una utility standalone per analizzare l'effetto del nuovo exit system:

- file: `src/utils/exitLifecycleReport.ts`
- test: `tests/exitLifecycleReport.test.js`

La utility aggrega trade chiusi ed eventi strutturati per:
- `closeReason`
- `closeClassification`
- `exitMechanism`
- `lifecycleEvent`
- `lifecycleState`
- `policyId`

Produce anche metriche dedicate su:
- managed recovery
- failed RSI exits
- deferred RSI exits
- post-loss Architect latch
- timing `signal -> execution`

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
- market mode / execution mode
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

Realtime market data + paper execution:

```bash
MARKET_MODE=live
EXECUTION_MODE=paper
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
- exit policy registry
- recovery target resolver
- position lifecycle manager
- exit lifecycle report

## Legacy

Il codice precedente e stato isolato in `legacy/`.

Non fa parte del nuovo runtime principale.
