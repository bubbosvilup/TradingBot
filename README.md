# TradingBot

Paper-trading runtime for market observation, strategy evaluation, risk-gated paper execution, and operator observability.

This README is a non-normative entry pointer. Canonical project guidance lives in:

- `AGENT.md`
- `docs/ARCHITECTURE.md`
- `docs/HANDOFF.md`

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Short smoke run:

```bash
npm start -- --duration-ms=5000 --summary-ms=1000
```

Pulse:

```text
http://127.0.0.1:3000/
```

## Test

```bash
npm test
```

```bash
npx -p typescript@5.6.3 tsc -p tsconfig.json --pretty false
```
