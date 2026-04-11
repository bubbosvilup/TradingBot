# TradingBot

Runtime multi-bot per paper trading, osservabilita realtime e refactor progressivo del motore decisionale.

Il progetto mantiene nel repository alcune fondamenta per lavori futuri come live readiness, backtest moderno e short support, ma il runtime attivo resta intenzionalmente limitato e difensivo.

## Stato attuale

| Aspetto | Stato attuale |
|---|---|
| Execution | Solo `paper` |
| Market feed runtime attivo | Solo `live` market data |
| Live order routing | Disabilitato dal runtime attivo |
| Dashboard | Frontend statico servito da `public/` con asset JS browser-ready |
| Backtest | Adapter moderno sopra il legacy, non ancora parita completa |
| Short support | Preparazione avviata, non abilitato |

Nota importante:
- `execution-mode=live` fallisce esplicitamente in bootstrap.
- Il runtime attivo non deve inizializzare o percorrere accidentalmente il path live.
- La presenza di codice live nel repository non implica live readiness.

## Flusso architetturale

```text
Binance market data
  -> streams
  -> StateStore
  -> ContextService
  -> ArchitectService
  -> TradingBot
  -> ExecutionEngine
  -> SystemServer / dashboard
```

Responsabilita chiave:
- `StateStore` e la fonte unica di verita in memoria.
- `ContextService` costruisce il contesto rolling per simbolo.
- `ArchitectService` pubblica regime e family consigliata.
- `TradingBot` orchestra entry, exit e execution entro il perimetro Architect.
- I coordinatori in `src/roles/` possiedono i flussi locali: entry gating, open attempt, exit decision, exit outcome, latch post-loss, telemetry.

Vincoli architetturali preservati:
- Il bot non decide il regime di mercato da solo.
- Il routing strategico non torna a essere hardcoded dentro `TradingBot`.
- La dashboard legge solo le API del runtime, non i sorgenti TypeScript UI.
- Il path live futuro resta preservato ma segregato dal runtime attivo.

## Aggiornamenti del 2026-04-10

Questi sono i lavori principali completati oggi e allineati al repository corrente.

### Sicurezza runtime

- Segregato il path live dal runtime attivo.
- `execution-mode=live` ora fallisce fast con messaggio esplicito.
- Il runtime attivo non avvia user stream live e non attraversa branch di execution live.
- Quarantinato il profilo tossico `allow_small_loss_floor05`.
- Aggiunto breaker per managed recovery con limite esplicito sui cicli consecutivi.
- Aggiunto portfolio-wide kill switch con modalita iniziale `block_entries_only`.
- Distinte in modo chiaro due semantiche diverse:
  - pausa bot per `max_drawdown_reached`
  - blocco condiviso per `portfolio_kill_switch_active`

### Telemetry ed economics

- `unrealizedPnl` e ora fee-aware nel runtime e nei payload server/dashboard.
- `closedAt` usa il timestamp del tick/evento quando il runtime lo ha gia disponibile.
- La reportistica managed recovery e stata resa piu conservativa e meno ambigua:
  - closed outcomes distinti dagli eventi deferred ancora aperti
  - breaker exits espliciti
  - minore rischio di metriche fuorvianti
- Corretto il vecchio bug di telemetry sul max drawdown:
  - la pausa con resume manuale emette sempre metadata espliciti e machine-readable
  - questo vale anche in `LOG_TYPE=verbose`
- Corretto il mismatch sui diagnostici Architect:
  - `warmupRemainingMs` usa il vero `architectWarmupMs`
  - non un valore hardcoded obsoleto
- `/api/system` e `/api/bots` espongono ora in modo esplicito:
  - `portfolioKillSwitch`
  - `pausedReason`
  - `manualResumeRequired`
  - conteggio bot in pausa e bot che richiedono resume manuale

### Runtime hygiene e costo operativo

- Aggiunta retention conservativa dello stato per simbolo in `StateStore`.
- Lo stato simbolo non cresce piu senza limite per simboli morti o inattivi.
- I simboli protetti non vengono evitti se:
  - appartengono a bot registrati
  - hanno posizioni aperte
- `ContextService` ripulisce la propria cache per simboli evitti.
- Ridotto il costo del REST fallback:
  - refresh ristretto ai simboli stale
  - skip dei simboli ancora freschi
  - batch `fetchTickers(...)` quando utile

### UI e serving

- La dashboard non dipende piu da import browser di file TypeScript raw da `src/ui/*.ts`.
- `public/index.html` carica asset JS servibili dal browser:
  - `/ui/chartAdapter.js`
  - `/ui/dashboardAdapter.js`
- `SystemServer` serve la UI dal path statico `public/ui/`.

### Backtest e prep futura

- `src/engines/backtestEngine.ts` non e piu uno scaffold vuoto:
  - e un adapter moderno sopra i moduli legacy preservati
  - lo stato reale e `bridged_not_fully_migrated`
- Avviata la prep per short support:
  - tipi e helper economici side-ready
  - nessuna abilitazione reale degli short nel runtime

### Performance e tuning

- Ridotto spreco nel hot path di `ContextBuilder`.
- Resi configurabili a runtime:
  - `architectWarmupMs`
  - `architectPublishIntervalMs`
  - `postLossLatchMinFreshPublications`
- Config attiva corrente:
  - warmup Architect `20000ms`
  - publish interval `15000ms`
  - post-loss latch `1` fresh publication minima

### Verifica

- La failure storica in `tests/tradingBot.test.js` sul max drawdown e stata risolta.
- `npm test` passa sullo stato corrente del repository.

## Config runtime attiva

File: `src/data/bots.config.json`

```json
{
  "executionMode": "paper",
  "marketMode": "live",
  "architectWarmupMs": 20000,
  "architectPublishIntervalMs": 15000,
  "postLossLatchMinFreshPublications": 1,
  "symbolStateRetentionMs": 1800000,
  "portfolioKillSwitch": {
    "enabled": true,
    "maxDrawdownPct": 8,
    "mode": "block_entries_only"
  },
  "experimentMetrics": {
    "enabled": false,
    "label": "quarantined_allow_small_loss_floor05",
    "summaryIntervalMs": 60000
  }
}
```

Bot attivi di default:
- `bot_btc_trend` su `BTC/USDT` con `emaCross`
- `bot_eth_reversion` su `ETH/USDT` con `rsiReversion`

## Cosa fa oggi

- Avvia piu bot indipendenti in parallelo.
- Riceve market data live da Binance Spot.
- Mantiene in memoria prezzi, posizioni, eventi, performance, contesto e stato Architect.
- Classifica il regime e pubblica una family consigliata.
- Riallinea i bot alla family pubblicata quando possono farlo in sicurezza.
- Esegue solo paper execution.
- Gestisce lifecycle posizione esplicito:
  - `ACTIVE`
  - `MANAGED_RECOVERY`
  - `EXITING`
  - `CLOSED`
- Applica guardrail locali e di portafoglio.
- Espone dashboard e API di osservabilita locale.

## Guardrail principali

- Managed recovery breaker:
  - limita recovery loops ripetuti
  - puo forzare una safety exit esplicita
- Max drawdown pause per bot:
  - lascia il bot in `paused`
  - richiede resume manuale
- Portfolio kill switch:
  - blocca nuovi ingressi a livello di sistema
  - non forza ancora flatten globale
- Post-loss Architect latch:
  - impedisce re-entry troppo aggressivi dopo una loss
  - ora e configurabile a runtime

## UI / API

La dashboard locale viene servita da `SystemServer` e usa asset statici browser-ready.

Route UI:
- dashboard completa: `http://127.0.0.1:3000/`
- monitor compatto: `http://127.0.0.1:3000/compact`

Endpoint principali:
- `GET /api/system`
- `GET /api/bots`
- `GET /api/prices`
- `GET /api/positions`
- `GET /api/events`
- `GET /api/trades`
- `GET /api/chart`
- `GET /api/analytics`

Campi diagnostici rilevanti ora esposti:
- stato portfolio kill switch
- retention/cleanup dello symbol state
- `pausedReason` per bot
- `manualResumeRequired` per bot
- stato compatto latch post-loss e managed recovery per bot
- diagnostica Architect published/observed/synthetic
- latency di pipeline

Il monitor compatto su `/compact` resta separato dalla dashboard completa: mostra strip globali/portfolio/safety, una tabella bot densa e due sole righe footer per ultimo trade e ultimo evento rischio. Include un filtro locale `abnormal only`; non espone controlli operativi e non mostra feed log.

Auto-apertura monitor compatto:

```bash
AUTO_OPEN_COMPACT_UI=true npm start
```

Opzioni:
- `AUTO_OPEN_COMPACT_UI=true` oppure `COMPACT_UI=true`
- `COMPACT_UI_ROUTE=/compact`

Il backend puo chiedere al sistema operativo di aprire la route compatta nel browser predefinito. Il controllo affidabile della dimensione finestra non e garantito tra browser e piattaforme senza introdurre un launcher browser-specifico, quindi l'apertura automatica usa la finestra predefinita del browser.

## Logging

Variabile supportata:

```bash
LOG_TYPE=verbose|minimal|only_trades|strategy_debug
```

Nota:
- gli eventi di rischio critici per max drawdown non vengono piu persi in `verbose`
- il runtime continua a emettere metadata strutturati per stato, blocchi e chiusure

## Avvio

Avvio standard:

```bash
npm start
```

Smoke test rapido:

```bash
node --experimental-strip-types src/core/orchestrator.ts --duration-ms=5000 --summary-ms=1000
```

Nota operativa:
- il runtime attivo richiede market data `live`
- `EXECUTION_MODE=paper` e l'unica execution supportata
- richieste `execution-mode=live` vengono rifiutate

## Test

Suite completa:

```bash
npm test
```

Verifica TypeScript:

```bash
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```

## Limiti attuali

- Nessun ordine reale su exchange.
- Nessuna live readiness end-to-end.
- Nessuna parita completa del backtest moderno con il runtime attivo.
- Nessun supporto short completo.
- Nessun comando/API dedicato per resume manuale del bot dopo max drawdown.

## Struttura repository

```text
src/
  bots/
  core/
  engines/
  roles/
  streams/
  strategies/
  data/
  types/
  ui/
  utils/
public/
legacy/
tests/
docs/
```

Hotspot da trattare con cautela:
- `src/bots/tradingBot.ts`
- `src/core/stateStore.ts`
- `src/core/orchestrator.ts`
- `src/core/systemServer.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/streams/marketStream.ts`
- `tests/tradingBot.test.js`

## Legacy e futuro

- Il codice in `legacy/` resta preservato per audit e migrazione graduale.
- `BacktestEngine` oggi e un ponte verso il legacy, non il runtime finale di replay.
- Il path live futuro resta nel repository ma non deve essere riattivato accidentalmente dal runtime attivo.
- Il prossimo lavoro utile resta:
  - backtest moderno piu integrato
  - audit short support
  - miglioramenti incrementali di performance e architettura
