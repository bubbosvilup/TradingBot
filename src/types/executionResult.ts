import type { ExecutionError } from "./errors.ts";
import type { ClosedTradeRecord, OrderRecord, PositionRecord } from "./trade.ts";

export type ExecutionOpenResult =
  | {
      ok: true;
      order: OrderRecord;
      position: PositionRecord;
    }
  | {
      ok: false;
      error: ExecutionError;
    };

export type ExecutionCloseResult =
  | {
      ok: true;
      closedTrade: ClosedTradeRecord;
      order: OrderRecord;
    }
  | {
      ok: false;
      error: ExecutionError;
    };
