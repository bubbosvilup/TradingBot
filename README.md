# TradingBot

TradingBot e un paper trading bot multi-market in Node.js con dashboard locale, stato persistente e selezione dinamica dei simboli. Il sistema usa una strategia multi-timeframe 1h / 5m / 1m, applica sizing basato sul rischio e mantiene una UI locale su `http://127.0.0.1:3000`.

Il motore supporta `STRATEGY_MODE=adaptive|trend|range_grid`. In `adaptive` il bot tratta i mercati direzionali con continuation / SFP e prova setup di tipo range-grid long-only quando il regime e laterale; in `range_grid` forza solo la logica di mean reversion sul bordo basso del range.

## Architettura

- `bot.js`: entrypoint e orchestrazione del loop.
- `src/strategy.js`: indicatori, scoring, decision state, entry engine, exit reason code.
- `src/runtime.js`: watchlist dinamica, fetch candele, esecuzione paper, gestione posizioni.
- `src/persistence.js`: persistenza di `state.json` e `trades.log`.
- `src/server.js`: API locali e payload della dashboard.
- `public/`: dashboard statica.
- `tests/`: test minimi su strategy e API status.

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

## Dati locali

I file runtime non devono essere versionati:

- `.env`
- `state.json`
- `trades.log`
- `node_modules/`

Il repository include un `.gitignore` per tenerli fuori dall'indice git.

## API locali

- `GET /api/status`: stato completo per la dashboard.
- `GET /api/trades`: lista trade della sessione.
- `POST /api/reset`: resetta la sessione paper.
- `POST /api/btc-filter`: abilita o disabilita il filtro BTC.
