# TradingBot

TradingBot e un paper trading bot multi-market in Node.js con dashboard locale, stato persistente e selezione dinamica dei simboli. Il sistema usa una strategia multi-timeframe 1h / 5m / 1m, applica sizing basato sul rischio e mantiene una UI locale su `http://127.0.0.1:3000`.

Il motore supporta `STRATEGY_MODE=adaptive|trend|range_grid`. In `adaptive` il bot tratta i mercati direzionali con continuation / SFP e prova setup di tipo range-grid long-only quando il regime e laterale; in `range_grid` forza solo la logica di mean reversion sul bordo basso del range.

Il profilo di esecuzione puo inoltre passare da `normal` a `aggressive`: in quel caso il bot abbassa in modo controllato le soglie di score, slope, volume, edge netto e risk/reward. La modalita aggressiva e attivabile sia in live dalla dashboard sia nel replay di Strategy Lab.

Oltre al loop live, il progetto include anche un laboratorio di ricerca: `npm run backtest` scarica dati OHLCV recenti, confronta `adaptive`, `trend` e `range_grid` sugli stessi simboli e salva un report locale in `backtest-report.json`, che la dashboard mostra nella sezione Strategy Lab.

Lo stesso laboratorio puo essere avviato anche dalla dashboard principale: il bot espone un job di backtest in background, salva il report su disco e mostra sia il riepilogo sia i round simulati per ogni modalita.

## Architettura

- `bot.js`: entrypoint e orchestrazione del loop.
- `src/strategy.js`: indicatori, scoring, decision state, entry engine, exit reason code.
- `src/runtime.js`: watchlist dinamica, fetch candele, esecuzione paper, gestione posizioni.
- `src/persistence.js`: persistenza di `state.json` e `trades.log`.
- `src/backtest.js`: replay engine per confrontare modalita strategiche sugli stessi dati storici.
- `src/server.js`: API locali e payload della dashboard.
- `public/`: dashboard statica.
- `scripts/backtest.js`: runner CLI per generare il report di ricerca.
- `tests/`: test minimi su strategy, runtime, server e replay.

## Requisiti

- Node.js 20+
- Dipendenze installate con `npm install`

## Avvio

1. Copia `.env.example` in `.env` e regola i parametri.
2. Installa le dipendenze con `npm install`.
3. Avvia il bot con `npm start`.
4. Apri `http://127.0.0.1:3000`.

La watchlist dinamica usa una pool ampia di mercati caldi aggiornata con `HOT_SYMBOLS_REFRESH_MS`; i simboli deboli non in focus vengono ruotati ogni `WEAK_SYMBOL_ROTATION_MS` in base a `WEAK_SYMBOL_RSI_MAX`, mantenendo sempre il focus corrente e le eventuali posizioni aperte. Il ranking interno separa `focusScore` da `opportunityScore` per ridurre i falsi focus.

## Script

- `npm start`: avvia il bot e la dashboard.
- `npm test`: esegue i test minimi con `node:test`.
- `npm run backtest`: scarica dati recenti, esegue il replay multi-modalita e aggiorna `backtest-report.json`.

## Dati locali

I file runtime non devono essere versionati:

- `.env`
- `state.json`
- `trades.log`
- `node_modules/`

Il repository include un `.gitignore` per tenerli fuori dall'indice git.

## Backtest rapido

1. Imposta `BACKTEST_SYMBOLS` se vuoi simboli specifici; altrimenti il runner usa i simboli caldi del momento.
2. Regola `BACKTEST_DAYS`, `BACKTEST_SYMBOL_LIMIT` e i delay di fetch.
3. Esegui `npm run backtest`.
4. Riavvia o aggiorna la dashboard per vedere il report in Strategy Lab.

## Strategy Lab in UI

Dalla dashboard puoi:

- avviare una ricerca direttamente dal browser
- scegliere giorni, numero simboli e simboli custom
- usare la watchlist attuale come base del replay
- spuntare un replay aggressivo per confrontare le stesse modalita con soglie piu spinte
- confrontare le modalita `adaptive`, `trend` e `range_grid`
- ispezionare i round simulati e gli eventi che il bot avrebbe eseguito
- attivare o disattivare la modalita aggressiva live senza riavviare il bot

## API locali

- `GET /api/status`: stato completo per la dashboard.
- `GET /api/trades`: lista trade della sessione.
- `POST /api/reset`: resetta la sessione paper.
- `POST /api/btc-filter`: abilita o disabilita il filtro BTC.
- `POST /api/aggressive-mode`: abilita o disabilita il profilo aggressivo live.
