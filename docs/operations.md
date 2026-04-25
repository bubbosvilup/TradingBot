# Operational Runbook

This runbook covers the active v18 paper runtime. It does not imply live-order readiness.

## Manual Post-Loss Latch Reset

Use this only when a bot is blocked by `post_loss_latch_timeout_requires_operator`.

Endpoint:

```text
POST /api/bots/:botId/reset-post-loss-latch
```

Behavior:
- Clears only post-loss Architect latch fields for that bot.
- Logs `manual_post_loss_latch_reset`.
- Does not unpause the bot.
- Does not clear cooldown, portfolio kill-switch, market freshness, risk state, positions, trades, or balances.

Expected no-op behavior:
- Unknown bot returns `404`.
- Bot without latch state returns `409`.

## Manual Portfolio Kill-Switch Reset

Use this only after an operator has acknowledged the triggered portfolio kill-switch.

Endpoint:

```text
POST /api/kill-switch/reset
```

Behavior:
- Clears only portfolio kill-switch trigger state: `triggered`, `triggeredAt`, `reason`, and `blockingEntries`.
- Preserves kill-switch config: `enabled`, `maxDrawdownPct`, and `mode`.
- Resets the portfolio peak reference to current equity so the next read does not immediately re-trigger from the already acknowledged drawdown.
- Logs `manual_portfolio_kill_switch_reset`.
- Does not clear bot paused state, cooldowns, post-loss latches, market freshness, positions, trades, balances, or PnL.

Expected no-op behavior:
- If the kill-switch is not triggered, the endpoint returns `409` with `portfolio_kill_switch_reset_not_required`.

## UserStream Disconnected Or Degraded

UserStream/WS failures should be treated as an operations signal, not as proof that trading state is safe to ignore.

Operator response:
- Check logs for `ws_manual_attention_needed`, `ws_closed`, `ws_idle_timeout`, listen-key failures, or keepalive errors.
- Check `/api/system`, `/api/pulse`, and recent events for connection status.
- Do not restart blindly if positions are open; first confirm whether the paper state already recorded the latest open/close event.
- If UserStream remains disconnected, treat exchange/user-event visibility as degraded and inspect the runtime state before any manual action.

Event publication is non-throwing in the runtime: a bad listener must not interrupt authoritative open/close state updates, but disconnected user streams still require operator attention.

## Paper Short Accounting Warning

`paper_full_notional_simplified` means the active paper runtime models short PnL with full-notional accounting.

It does not model:
- margin
- borrowing
- liquidation
- mark price
- funding

Do not use this accounting model as futures/margin realism. v20 owns realistic futures/short accounting.

## Native WebSocket Requirement

The default WebSocket path requires Node.js with native `globalThis.WebSocket`.

Runtime requirement:

```text
Node.js >= 22.4.0 with native WebSocket enabled, or an injected websocketFactory.
```

If native WebSocket is unavailable, `WSManager` fails fast with an actionable error instead of failing later with an obscure constructor error.
