# TradingBot

Runtime multi-bot per paper trading, osservabilita realtime e refactor progressivo del motore decisionale.

Il progetto mantiene nel repository alcune fondamenta per lavori futuri come live readiness, backtest moderno e short support, ma il runtime attivo resta intenzionalmente limitato e difensivo.

## Stato attuale

| Aspetto | Stato attuale |
|---|---|
| Execution | Solo `paper` |
| Market feed runtime attivo | Solo `live` market data |
| Live order routing | Disabilitato dal runtime attivo |
| Dashboard | Pulse UI statica servita da `public/` sulla route root `/` |
| Backtest | Adapter moderno sopra il legacy, non ancora parita completa |
| Short support | Supporto short di prima classe nel runtime paper e nelle superfici report principali; replay/backtest parity ancora non completata |
| MTF | Infrastruttura e diagnostica presenti, abilitato nella config default e spegnibile via env |
| Historical preload | Preload startup-only da Binance/ccxt REST, opzionale e configurabile |
/api/chart and buildChartPayload() are retained as backend-only/dormant chart data surfaces for future replay/UI work. Pulse does not currently consume them.

Nota importante:
- `execution-mode=live` fallisce esplicitamente in bootstrap.
- Il runtime attivo non deve inizializzare o percorrere accidentalmente il path live.
- La presenza di codice live nel repository non implica live readiness.

## Current status (v18)

- Runtime paper/live-data stabile sullo stato corrente del repository.
- Nessun P0 aperto.
- Fix P1 pre-v19 completati:
  - `classifyClosedTrade` usa prima metadata strutturati di exit (`exitPlan` / `lifecycleEvent`) e lascia il reason-string matching solo come fallback limitato nei casi RSI strutturalmente ambigui
  - `mtf.instabilityThreshold` controlla ora il gate Architect lato usability con default invariato `0.5`
- Audit 22-23 aprile completato:
  - coerenza paused-state
  - exit capability flags authoritative
  - validazione esplicita del portfolio kill switch
  - short support runtime paper end-to-end
- Logging cleanup P2 completato:
  - ownership entry chiarita
  - payload Architect slim
  - `trade_closed` come evento canonico di exit
- Stabilizzazione v18 pre-chiusura completata:
  - recovery manuale esplicita per latch Architect post-loss in timeout tramite `POST /api/bots/:botId/reset-post-loss-latch`
  - freshness dei dati mercato basata su tempo runtime di ricezione/aggiornamento, non sul timestamp exchange del tick
  - preview/snapshot del portfolio kill-switch basati su clock runtime
  - exit sotto dati degraded/stale ancora consentite, ma visibili con `degraded_data_exit_warning`
  - costruzione stato bot in `registerBot(...)` resa esplicita e piu leggibile
  - cleanup naming per invarianti lifecycle e scadenza freshness
  - costanti temporali MarketStream nominate
  - regole agent/coding allineate per evitare commenti generici, wrapper inutili e test autoreferenziali
- Hot-path allocation issues gia verificati e bloccati da test; il codice production era gia allineato.
- v18 e ora in stato pre-closure stabilizzato. Il runtime resta paper-only, Pulse-only e difensivo; backtest moderno, margin realism e optimization lab restano lavori futuri.

## Flusso architetturale

```text
startup historical preload
  -> StateStore
Binance market data
  -> streams
  -> StateStore
  -> ContextService
  -> optional MTF context / aggregation
  -> ArchitectService
  -> TradingBot
  -> ExecutionEngine
  -> SystemServer / dashboard
```

Responsabilita chiave:
- `StateStore` e la fonte unica di verita in memoria.
- `HistoricalBootstrapService` e un bootstrap startup-only: usa lo stesso provider REST di `MarketStream`, normalizza history recente e la inserisce nello store con i path esistenti.
- `ContextService` costruisce il contesto rolling per simbolo.
- `ArchitectService` pubblica regime e family consigliata.
- `MtfContextService` e `mtfContextAggregator` costruiscono diagnostica multi-timeframe opzionale con frame interni `short`, `medium`, `long`.
- `TradingBot` orchestra entry, exit e execution entro il perimetro Architect.
- I coordinatori in `src/roles/` possiedono i flussi locali: entry gating, open attempt, exit decision, exit outcome, latch post-loss, telemetry e resolver policy puri.

Vincoli architetturali preservati:
- Il bot non decide il regime di mercato da solo.
- Il routing strategico non torna a essere hardcoded dentro `TradingBot`.
- `TradingBot` non interpreta MTF e non contiene branching strategico MTF.
- Il target-distance gate resta in `entryCoordinator`; il resolver MTF produce solo hint/cap diagnostici per l'economics.
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
- Il teardown di `MarketStream` ora invalida snapshot REST fallback in-flight e impedisce che close WS durante shutdown riattivi fallback, evitando log tardivi dopo la fine dei test.

### UI e serving

- La dashboard non dipende piu da import browser di file TypeScript raw da `src/ui/*.ts`.
- `public/index.html` carica gli asset browser serviti da `public/`.
- `SystemServer` serve la UI Pulse dagli asset statici pubblici del repository.

### Backtest e prep futura

- `src/engines/backtestEngine.ts` non e piu uno scaffold vuoto:
  - e un adapter moderno sopra i moduli legacy preservati
  - lo stato reale e `bridged_not_fully_migrated`
- Avviata la base per side handling:
  - tipi e helper economici side-ready
  - questa base e stata poi estesa nei commit successivi fino ad abilitare short paper end-to-end nel runtime attivo

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

## Aggiornamenti del 2026-04-11

### Monitor compatto locale

- Nota storica: questa sezione descrive un passaggio intermedio poi superato; il monitor compatto separato non e piu una UI attiva distinta e `/compact` viene normalizzato a `/`.
- Aggiunta una pagina dedicata `/compact` per osservabilita locale ad alta densita.
- In quel passaggio il monitor compatto restava separato dalla dashboard completa senza introdurre una seconda architettura frontend attiva.
- Il monitor compatto mostra solo stato runtime, portfolio, safety, righe bot dense, ultimo trade e ultimo evento rischio.
- Aggiunto filtro locale `abnormal only` per restringere la vista a posizioni aperte, pause, resume manuali, recovery, kill switch o reason di blocco.
- Aggiunta apertura automatica opt-in:
  - `AUTO_OPEN_COMPACT_UI=true`
  - `COMPACT_UI=true`
  - `COMPACT_UI_ROUTE=/compact`
- Il backend apre la route nel browser predefinito quando possibile; non forza dimensione finestra perche il controllo affidabile cross-platform richiederebbe un launcher/browser-specifico.

### Coerenza Architect / entry / exit

- L'ingresso ora blocca quando l'Architect ha `hysteresisActive=true` e il `challengerRegime` mappa a una family diversa dalla strategia corrente.
- Il blocco usa `architect_challenger_pending` e impedisce entry in una transizione di regime gia pendente.
- L'invalidazione `family_mismatch` in managed recovery non scatta piu su una singola mismatch immediata.
- Le invalidazioni non-protettive sensibili a regime (`family_mismatch`, low maturity, stale, not ready) rispettano una grace post-entry derivata dal publish interval Architect.
- Le uscite protettive restano prioritarie e non sono state indebolite.
- In managed recovery la priorita e ora:
  - protective stop
  - timeout recovery
  - target recovery confermato
  - invalidazione
- Un target recovery gia confermato non viene piu convertito in uscita per invalidazione.
- Le RSI exit sotto il floor netto non entrano piu in managed recovery: chiudono subito con `rsi_exit_floor_failed`.

### Edge temporale RSI

- `rsiReversion` ora usa un floor minimo piu conservativo:
  - `minExpectedNetEdgePct: 0.0015`
- Aggiunto vincolo di distanza target short-horizon:
  - `maxTargetDistancePctForShortHorizon: 0.01`
- L'economics di entry espone ora:
  - `targetDistancePct`
  - `maxTargetDistancePctForShortHorizon`
- Il gate finale blocca con `target_distance_exceeds_short_horizon` se il target statico richiede una distanza incompatibile con l'orizzonte corto.
- Questo non introduce modelli predittivi: e solo un sanity gate deterministico sul target statico.

### Verifica

- Aggiornati test mirati per:
  - challenger Architect pendente in entry
  - grace contro invalidazione precoce
  - target recovery che batte invalidazione
  - RSI exit sotto floor che salta managed recovery
  - blocco su target distance short-horizon
- `npm test` passa sullo stato corrente del repository.

## Aggiornamenti del 2026-04-12

### MTF Architect e RSI entry

- Aggiunta infrastruttura MTF opzionale dietro `mtf.enabled`:
  - `src/core/mtfContextService.ts`
  - `src/roles/mtfContextAggregator.ts`
  - `src/types/mtf.ts`
- I frame MTF pubblicati usano id interni:
  - `short`
  - `medium`
  - `long`
- Le label raw di mercato (`1m`, `5m`, `15m`, `1h`, ecc.) restano mappate nella configurazione frame / plumbing MTF, non nel resolver policy.
- `ArchitectService` puo allegare `mtf` a `ArchitectAssessment` con:
  - `mtfEnabled`
  - `mtfAgreement`
  - `mtfInstability`
  - `mtfDominantFrame`
  - `mtfDominantTimeframe`
  - `mtfMetaRegime`
  - `mtfReadyFrameCount`
  - `mtfSufficientFrames`
- `mtf.enabled` e abilitato nella config default corrente; `MTF_ENABLED=false` lo spegne senza cambiare il JSON.

### RSI MTF cap resolution

- Aggiunto `src/roles/mtfParamResolver.ts` come resolver puro e deterministico per `rsiReversion`.
- Il resolver non possiede gating, sizing, cooldown, hold o exit semantics.
- Il resolver mantiene invariati in questo patch:
  - `resolvedBuyRsi`
  - `resolvedSellRsi`
  - floor RSI `resolvedMinExpectedNetEdgePct >= 0.0015`
- La policy target-distance cap e:
  - `short`: baseline invariata
  - `medium`: `1.5x` cap baseline
  - `long`: `2.0x` cap baseline
  - disabled, unclear, unstable, insufficient, non-range o missing dominant: baseline invariata
- Il widening richiede contesto coerente:
  - MTF enabled
  - sufficient ready frames
  - `mtfMetaRegime === "range"`
  - `mtfDominantFrame` presente
  - `mtfInstability <= 0.25`
  - `mtfAgreement >= 0.75`
- `entryEconomicsEstimator` calcola il cap risolto e lo espone in `EntryEconomicsEstimate`.
- `entryCoordinator` resta il proprietario del blocco finale `target_distance_exceeds_short_horizon`.

### Telemetry MTF

- I log full entry espongono ora sia diagnostica MTF published-side sia diagnostica entry-side:
  - `publishedMtfEnabled`
  - `publishedMtfAgreement`
  - `publishedMtfInstability`
  - `publishedMtfDominantFrame`
  - `publishedMtfDominantTimeframe`
  - `publishedMtfSufficientFrames`
  - `publishedMtfMetaRegime`
  - `resolvedMtfDominantFrame`
  - `resolvedMtfAdjustmentApplied`
  - `resolvedMtfTargetDistanceCapPct`
  - `resolvedMtfTargetDistanceProfile`
  - `resolvedMtfFallbackReason`
  - `resolvedMtfResolutionReason`
- I metadata compatti `SETUP` / `BLOCK_CHANGE` includono ora:
  - `targetDistancePct`
  - `maxTargetDistancePctForShortHorizon`
  - `resolvedMtfAdjustmentApplied`
  - `resolvedMtfTargetDistanceCapPct`
  - `resolvedMtfTargetDistanceProfile`
  - `resolvedMtfFallbackReason`
  - `resolvedMtfResolutionReason`
  - `resolvedMtfDominantFrame`
- `/api/bots` preserva `architectPublished.mtf` come diagnostica server-facing.

### Historical startup preload

- Aggiunto `src/core/historicalBootstrapService.ts` come fase di bootstrap startup-only.
- La sequenza startup rilevante e:
  - preload storico nello `StateStore`
  - `marketStream.start(...)`
  - `contextService.start(...)`
  - `architectService.start(...)`
  - `botManager.startAll()`
- Il preload usa lo stesso exchange/data source gia configurato per `MarketStream` (`binance` via ccxt REST), senza provider esterni.
- Le candele storiche vengono normalizzate e inserite nello store con i path esistenti:
  - `store.updatePrice(...)` per la serie price/tick derivata dal timeframe prezzo
  - `store.updateKline(...)` per la history kline
- Lo store resta la fonte unica di verita: `ContextService` e `MtfContextService` beneficiano del preload leggendo la history esistente.
- La copertura minima deriva da `ContextService.maxWindowMs`, `architectWarmupMs` e largest MTF frame `windowMs`.
- Failure policy:
  - `required=false`: log degradato e continua live-only warmup
  - `required=true`: abort startup prima di avviare market stream/context/Architect/bot
- Questo non cambia threshold, cadence, cooldown, fees, MTF policy, entry/exit o execution routing.

### Verifica

- Aggiornati test mirati per:
  - resolver MTF RSI
  - MTF context aggregator/service
  - economics RSI con cap MTF
  - tick-path baseline vs coherent MTF widening
  - telemetry full/compact MTF
  - pass-through `/api/bots` di `architectPublished.mtf`
  - preload storico disabled/success/optional failure/required failure
  - readiness iniziale MTF tramite history seedata nello store
  - teardown `MarketStream` senza log REST fallback tardivi dopo `PASS all`
- Passano:
  - `npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false`
  - `npm test`
  - `git diff --check`

## Aggiornamenti del 2026-04-21

### Short support e side semantics

- Il runtime paper e ora side-aware anche per gli short:
  - strategie attive possono aprire e chiudere posizioni short
  - `ExecutionEngine` gestisce open, cover, PnL e fee in modo direzionale
  - `OpenAttemptCoordinator` non ricade piu implicitamente su long quando uno short non e supportato
  - `SystemServer`, chart markers e telemetry distinguono in modo esplicito `BUY` / `SELL` / `SHORT` / `COVER`
- Questo non rende il progetto live-ready:
  - execution resta solo `paper`
  - backtest moderno e analytics/reporting vanno ancora verificati end-to-end sul lato short

Backtest / replay status
- The active paper runtime is side-aware and supports short positions.
- The current backtest/replay path still runs through legacy replay modules via `BacktestEngine`.
- Replay is not in parity with the active runtime.
- Flat-market short-entry semantics are hard-failed to avoid misleading reports.
- Do not treat current backtest results as validation for short-capable strategies until replay parity is implemented.

### Report / export clarity

- Le superfici operator-facing principali del runtime attivo distinguono ora in modo esplicito gli short:
  - `SystemServer.buildTradesPayload()` espone `side: "short"` sui closed trades
  - `SystemServer.buildChartPayload()` usa marker `SHORT` / `COVER`
  - Pulse e `buildPositionsPayload()` mostrano posizioni aperte short con side normalizzato e label esplicita
- `exitLifecycleReport` e ora short-aware anche sui log evento:
  - i close log `COVER` arricchiscono i close short come i `SELL` arricchiscono i close long
  - il latch post-loss riconosce re-entry `SHORT` oltre ai re-entry `BUY`
- `ExperimentReporter` aggiunge ora un indicatore additivo `sideSummary` nei report testuali:
  - `long_only`
  - `short_only`
  - `mixed`
  - `none`
- Questo migliora chiarezza e regressione test sul runtime/reporting attivo, ma non equivale ancora a replay/backtest short parity.

### Pulse UI consolidata

- La UI operativa attiva e ora una sola:
  - Pulse su `/`
- Il vecchio monitor compatto non e piu una superficie separata:
  - `/compact` viene normalizzato a `/`
- Pulse usa:
  - `GET /api/pulse`
  - `GET /api/pulse/stream`
- Il frontend Pulse attivo non carica piu una libreria chart browser e non usa piu `/api/chart`.
- Pulse espone anche azioni operatore strette e gia previste dal backend:
  - resume manuale dei bot in pausa per `max_drawdown_reached`
  - storico trade per bot

### Trimming e hygiene recenti

- Sono entrate varie patch di trimming che hanno ridotto wrapper e rumore intorno a `TradingBot` senza cambiare il perimetro di sicurezza del runtime.
- Il prossimo cleanup tecnico emerso dai commit recenti e dalla cronologia locale riguarda soprattutto il logging, non la safety di base.
- Verifica attuale:
  - al `2026-04-21` `npm test` passa sul repository corrente

### Focus operativo successivo

- Il focus immediato e v18.1: rifiniture post-stabilizzazione senza grandi redesign.
- TickProcessingSnapshot / hot-path history sharing:
  - ridurre letture duplicate di price history
  - arrivare a un solo snapshot immutabile per tick solo se il cambio resta piccolo e verificabile
  - trattare il percorso `MarketStream -> ContextService -> Architect -> TradingBot` come area sensibile
- MTF boundary validation:
  - `configLoader` valida gia frame duplicati e `windowMs` invalidi
  - aggiungere una guardia anche in `MtfContextService` solo se si puo riusare logica condivisa senza duplicazione invasiva
- SystemServer Clock:
  - sostituire i `Date.now()` residui in payload/API con il clock iniettato
  - obiettivo: testabilita e determinismo, non cambio trading behavior
- Backtest legacy smoke test minimo:
  - usare una serie deterministica
  - verificare trade count / PnL atteso
  - evitare test che provano solo stringhe di capability
- MarketStream naming residuo:
  - rinominare eventuali `handle*` locali solo se il rename e sicuro e non causa cascade
- Docs/runbook operativo:
  - documentare reset post-loss latch
  - documentare cosa fare se `UserStream` resta disconnected
  - spiegare cosa significa `paper_full_notional_simplified`

## Aggiornamenti del 2026-04-22

### Hardening finale pre-launcher

- Chiuso il primo wave di audit runtime senza redesign architetturale.
- `StateStore` ora valida esplicitamente la modalita del portfolio kill switch contro una singola source of truth condivisa e rifiuta valori non supportati invece di normalizzarli in silenzio.
- `registerBot(...)` non ripristina piu uno stato `stopped` stale su bot ri-registrati abilitati.
- `registerBot(...)` preserva invece stati `paused` gia validi quando esiste un `pausedReason` esplicito.
- `paused` non deve piu esistere senza `pausedReason`:
  - la chiusura di una posizione mentre il bot e in pausa preserva il reason esistente
  - se manca un reason valido, il close path normalizza fuori da `paused`

### Exit policy capability flags

- Le semantiche di uscita di `rsiReversion` non sono piu abilitate per nome strategia.
- Le capability attive sono ora policy-driven tramite:
  - `exitPolicy.qualification.rsiThresholdExit`
  - `exitPolicy.recovery.priceTargetExit`
- Se una capability e `false`:
  - quel trigger non deve causare una chiusura
  - il coordinator non ricade piu su una generic exit confermata
  - i reason string disabilitati non devono riapparire downstream come classificazione `qualification` o `recovery`
- Il target di managed recovery rispetta anch'esso `recovery.priceTargetExit`.

### Pause semantics operative

- `paused` e ora autorevole a runtime:
  - bot in pausa e flat: nessuna strategia/entry attempt
  - bot in pausa con posizione aperta: le uscite restano consentite
  - `RiskManager.canOpenTrade(...)` blocca sempre nuove aperture quando `status === "paused"`
- Il resume manuale via `POST /api/bots/:botId/resume` resta volutamente stretto:
  - funziona solo per `pausedReason=max_drawdown_reached`
  - non e stato allargato ai pause reason generici

### Note implementative fissate a documentazione

- L'RSI corrente in `IndicatorEngine` resta intenzionalmente una simple-window RSI, non Wilder-smoothed RSI.
- Le soglie della strategia sono calibrate su questa implementazione attuale; non cambiare l'algoritmo senza ritaratura esplicita.
- L'accounting short del runtime paper resta una semplificazione full-notional:
  - apertura short: riserva bilancio come un long
  - chiusura short: rilascia il notional di entry come un long
  - metriche balance/equity non vanno interpretate come margin accounting realistico

### Verifica

- Aggiornati test mirati per:
  - capability flags exit authoritative
  - managed recovery target gating
  - paused bot flat vs paused bot con posizione
  - preservazione di `pausedReason` dopo close
  - validazione esplicita del kill switch mode
- `npm test` passa sul repository corrente dopo il fix finale del paused-state dead end.

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
  },
  "historicalPreload": {
    "enabled": true,
    "required": false,
    "priceTimeframe": "1m",
    "timeframes": ["1m", "5m", "15m", "1h"],
    "maxHorizonMs": 14400000,
    "timeoutMs": 15000,
    "limit": 600
  }
}
```

Bot attivi di default:
- `bot_btc_trend` su `BTC/USDT` con `emaCross`
- `bot_eth_reversion` su `ETH/USDT` con `rsiReversion`

Config rilevante per `rsiReversion`:

```json
{
  "exitPolicyId": "RSI_REVERSION_PRO",
  "maxTargetDistancePctForShortHorizon": 0.01,
  "minExpectedNetEdgePct": 0.0015
}
```

Nota MTF:
- la config default corrente abilita `mtf.enabled`
- `mtf.instabilityThreshold` governa il blocco Architect/usability ed e `0.5` di default
- il resolver `mtfParamResolver` usa invece una soglia distinta `0.25` per consentire widening conservativo dei parametri RSI
- le due soglie non sono equivalenti:
  - `0.5` = gate Architect su instabilita MTF alta
  - `0.25` = gate piu stretto per la sola risoluzione dei parametri entry
- `MTF_ENABLED=false` spegne MTF a runtime; `MTF_ENABLED=true` lo forza acceso anche se il JSON viene spento
- quando MTF e assente o disabilitato, il comportamento RSI resta baseline-identico

Nota historical preload:
- la config default corrente abilita `historicalPreload.enabled` in modalita opzionale (`required=false`)
- env override supportati:
  - `HISTORICAL_PRELOAD_ENABLED`
  - `HISTORICAL_PRELOAD_REQUIRED`
  - `HISTORICAL_PRELOAD_HORIZON_MS`
  - `HISTORICAL_PRELOAD_MAX_HORIZON_MS`
  - `HISTORICAL_PRELOAD_TIMEOUT_MS`
  - `HISTORICAL_PRELOAD_TIMEFRAMES`
  - `HISTORICAL_PRELOAD_PRICE_TIMEFRAME`
  - `HISTORICAL_PRELOAD_LIMIT`
- il preload resta bootstrap-only: non aggiunge fetch storici nel tick path.

## Cosa fa oggi

- Avvia piu bot indipendenti in parallelo.
- Riceve market data live da Binance Spot.
- Prima dell'osservazione runtime, puo seedare history recente via preload storico opzionale.
- Mantiene in memoria prezzi, posizioni, eventi, performance, contesto e stato Architect.
- Classifica il regime e pubblica una family consigliata.
- Se abilitato, calcola diagnostica MTF e la pubblica dentro `ArchitectAssessment.mtf`.
- Riallinea i bot alla family pubblicata quando possono farlo in sicurezza.
- Esegue solo paper execution.
- Gestisce lifecycle posizione esplicito:
  - `ACTIVE`
  - `MANAGED_RECOVERY`
  - `EXITING`
  - `CLOSED`
- Applica guardrail locali e di portafoglio.
- Blocca entry durante hysteresis Architect se il challenger punta a una family diversa.
- Per `rsiReversion`, puo usare diagnostica MTF coerente per risolvere il cap target-distance nell'economics, lasciando il gate finale in `entryCoordinator`.
- Espone dashboard e API di osservabilita locale.

## Guardrail principali

- Managed recovery breaker:
  - limita recovery loops ripetuti
  - puo forzare una safety exit esplicita
- Managed recovery invalidation:
  - non chiude piu su una singola mismatch precoce
  - applica una grace post-entry per invalidazioni non protettive sensibili a regime
  - lascia le uscite protettive prioritarie
  - lascia il target recovery confermato battere l'invalidazione
- RSI floor exit:
  - se la RSI exit stimata resta sotto il floor netto, non apre un nuovo ciclo di managed recovery
  - chiude con `rsi_exit_floor_failed`
- RSI target-distance entry:
  - baseline cap `0.01`
  - MTF coerente `medium` puo risolvere `0.015`
  - MTF coerente `long` puo risolvere `0.02`
  - contesto MTF ambiguo o disabilitato resta baseline
  - il reject finale resta `target_distance_exceeds_short_horizon` in `entryCoordinator`
- Max drawdown pause per bot:
  - lascia il bot in `paused`
  - richiede resume manuale esplicito via `POST /api/bots/:botId/resume`
- Pause non-drawdown:
  - bloccano nuove entry come stato runtime autorevole
  - possono convivere con una posizione aperta per permettere il close
  - devono sempre mantenere un `pausedReason` esplicito
- Portfolio kill switch:
  - blocca nuovi ingressi a livello di sistema
  - non forza ancora flatten globale
- Post-loss Architect latch:
  - impedisce re-entry troppo aggressivi dopo una loss
  - ora e configurabile a runtime

## UI / API

La dashboard locale viene servita da `SystemServer` e usa asset statici browser-ready.

Route UI:
- Pulse UI: `http://127.0.0.1:3000/`

Endpoint principali:
- `GET /api/system`
- `GET /api/bots`
- `GET /api/pulse`
- `GET /api/pulse/stream`
- `GET /api/prices`
- `GET /api/positions`
- `GET /api/events`
- `GET /api/trades`
- `GET /api/chart`
- `GET /api/analytics`
- `POST /api/bots/:botId/resume`

`POST /api/bots/:botId/resume` e intenzionalmente stretto: funziona solo per bot in pausa con `pausedReason=max_drawdown_reached`, non riprende bot che non richiedono resume manuale e non bypassa un portfolio kill switch attivo.

Semantica pause rilevante:
- `pausedReason=max_drawdown_reached` indica una pausa con resume manuale esplicito esposta anche in Pulse.
- altri `pausedReason` possono esistere come pause operative/runtime, ma non vengono ripresi tramite l'endpoint di manual resume.
- lo stato runtime non deve mai persistere `status=paused` con `pausedReason` nullo o vuoto.

Campi diagnostici rilevanti ora esposti:
- stato portfolio kill switch
- retention/cleanup dello symbol state
- `pausedReason` per bot
- `manualResumeRequired` per bot
- stato compatto latch post-loss e managed recovery per bot
- diagnostica Architect published/observed/synthetic
- diagnostica MTF published: `architectPublished.mtf`
- diagnostica short-horizon edge: `targetDistancePct` e `maxTargetDistancePctForShortHorizon`
- diagnostica MTF RSI entry: `resolvedMtfDominantFrame`, `resolvedMtfAdjustmentApplied`, `resolvedMtfTargetDistanceCapPct`, `resolvedMtfTargetDistanceProfile`, `resolvedMtfFallbackReason`, `resolvedMtfResolutionReason`
- latency di pipeline

Pulse e oggi l'unica UI operativa del repository: mostra stato di sistema, card bot, pannello focus, dettagli posizione, eventi recenti, storico trade e resume manuale quando il backend lo consente. Resta una superficie di osservabilita e controllo stretto, non un piano di decisione trading.

Auto-apertura Pulse:

```bash
AUTO_OPEN_COMPACT_UI=true npm start
```

Opzioni:
- `AUTO_OPEN_COMPACT_UI=true` oppure `COMPACT_UI=true`
- `COMPACT_UI_ROUTE=/` oppure un path custom valido

Il backend puo chiedere al sistema operativo di aprire Pulse nel browser predefinito. Il controllo affidabile della dimensione finestra non e garantito tra browser e piattaforme senza introdurre un launcher browser-specifico, quindi l'apertura automatica usa la finestra predefinita del browser.

## Logging

Variabile supportata:

```bash
LOG_TYPE=verbose|minimal|only_trades|strategy_debug
```

Nota:
- il default e `minimal`, orientato a log operativi compatti
- `LOG_TYPE=verbose` mantiene i dump completi di contesto/feature per debug approfondito
- gli eventi di rischio critici per max drawdown non vengono piu persi in `verbose`
- il runtime continua a emettere metadata strutturati per stato, blocchi e chiusure

Modello corrente delle superfici:
- `event`: fatti causali append-only come `entry_gate_allowed`, `entry_gate_blocked`, `trade_closed` ed eventi Architect publish/change/hold.
- `state`: snapshot rolling di stato runtime come cooldown, latch, bot status e stato Architect corrente.
- `counter`: aggregati come entry counts, blocked counts e contatori diagnostici.
- `summary`: superfici derivate/UI come Pulse e payload dashboard.

Ownership fissata dopo il cleanup P2:
- Gli eventi `entry_gate_allowed` / `entry_gate_blocked` sono il record dettagliato canonico della decisione entry.
- `BUY` / `SHORT` sono transizioni lifecycle compatte di open.
- `trade_closed` e la singola source of truth dettagliata per la causalita di exit.
- `SELL` / `COVER` / `RISK_CHANGE` restano transizioni lifecycle compatte.
- `managed_recovery_exited` e `failed_rsi_exit` restano tag semantici/annotation events, non duplicati del payload completo di close.
- Gli eventi Architect append-only mantengono i fatti causali di publish/hold/change e non riecheggiano piu l'intero context snapshot.
- `classifyClosedTrade` e ora structured-first:
  - usa prima `exitPlan` / `lifecycleEvent`
  - usa il reason-string matching solo come fallback stretto quando il modello strutturato RSI non distingue da solo i sottocasi
- `resolvedMtf*` indica input/decisione locale risolta nel tick path.
- `publishedMtf*` indica stato MTF gia pubblicato dall'Architect.

Lo schema debug/jsonl definitivo non e ancora formalizzato. Il lavoro residuo e solo fissare esplicitamente queste categorie in un contratto stabile, non riaprire il cleanup dei payload gia chiuso.

## Avvio

Avvio standard:

```bash
npm start
```

Smoke test rapido:

```bash
npm start -- --duration-ms=5000 --summary-ms=1000
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
- Replay/backtest resta legacy-backed e non valida strategie short-capable.
- Nessun launcher dedicato per scegliere la modalita di avvio o il profilo di cattura debug.
- Nessun contratto definitivo per l'output `jsonl` delle run debug; oggi esiste solo il groundwork di ownership/categorie logging.
- Pulse/UI richiede ancora stabilizzazione operativa, ma resta l'unica superficie UI attiva.
- Exit capability flags e pause semantics sono ora allineate al runtime reale e sufficientemente stabili da poter essere usate come base del lavoro launcher/debug, senza riaprire prima questo audit safety.

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
- `src/roles/architectCoordinator.ts`
- `src/roles/entryCoordinator.ts`
- `src/roles/entryEconomicsEstimator.ts`
- `src/roles/mtfParamResolver.ts`
- `src/roles/mtfContextAggregator.ts`
- `src/roles/tradingBotTelemetry.ts`
- `src/core/mtfContextService.ts`
- `src/roles/exitDecisionCoordinator.ts`
- `src/roles/managedRecoveryExitResolver.ts`
- `src/streams/marketStream.ts`
- `tests/tradingBot.test.js`

## Legacy e futuro

- Il codice in `legacy/` resta preservato per audit e migrazione graduale.
- `BacktestEngine` oggi e un ponte verso il legacy, non il runtime finale di replay.
- Il path live futuro resta nel repository ma non deve essere riattivato accidentalmente dal runtime attivo.
- `paper_full_notional_simplified` indica il modello paper attuale per short: contabilita full-notional semplificata, non futures margin realistico.
- Il prossimo lavoro utile e ordinato cosi:
  - v18.1: cleanup mirato e runbook operativo
  - v19: backtest moderno/paritario
  - v20: short/futures/margin realism
  - v21: strategy lab / optimization

## Roadmap minima

- v18 -> pre-closure stabilizzato dopo patch manual recovery, freshness/clock semantics, exit warning metadata, readability cleanup e docs agent/coding
- v18.1 -> rifiniture post-stabilizzazione:
  - TickProcessingSnapshot / hot-path history sharing
  - MTF boundary validation se piccola e condivisa
  - SystemServer Clock cleanup
  - legacy backtest smoke test minimo
  - MarketStream naming residuo
  - runbook reset latch, UserStream disconnected, `paper_full_notional_simplified`
- v19 -> backtest moderno/paritario:
  - data layer serio e dataset quality scanner
  - event-driven replay con clock deterministico e no lookahead
  - execution realism v1
  - report strategico serio
  - anti-lookahead harness
  - legacy deprecation path
- v20 -> paper futures isolated margin v1:
  - accounting long/short unificato
  - leverage e margin
  - liquidation model
  - mark price vs last price
  - funding semplificato prima, storico dopo se serve
  - portfolio risk compatibile con margin
- v21 -> strategy lab / optimization:
  - walk-forward analysis
  - parameter sweeps e sensitivity maps
  - out-of-sample validation
  - Monte Carlo stress
  - benchmark seri
  - confronto strategie su stabilita, drawdown, tail risk e recovery time, non solo profitto
