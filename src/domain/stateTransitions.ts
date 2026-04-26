import type { PositionRecord } from "../types/trade.ts";
import type { PositionState } from "./stateSelectors.ts";

const { createInvariantError } = require("../types/errors.ts");
const {
  assertValidPositionState,
  derivePositionState
} = require("./stateSelectors.ts");

export type PositionTransitionInput = PositionState | PositionRecord | null | undefined;
export type OrderState = "created" | "opened" | "closed" | "rejected";

const ALLOWED_POSITION_TRANSITIONS: Record<PositionState, PositionState[]> = {
  flat: ["open_active"],
  open_active: ["open_managed_recovery", "exiting", "flat"],
  open_managed_recovery: ["exiting", "flat"],
  exiting: ["flat"]
};

const ALLOWED_ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  created: ["opened", "closed", "rejected"],
  opened: ["closed"],
  closed: [],
  rejected: []
};

function resolvePositionTransitionState(input: PositionTransitionInput): PositionState {
  if (
    input === "flat"
    || input === "open_active"
    || input === "open_managed_recovery"
    || input === "exiting"
  ) {
    return input;
  }
  assertValidPositionState(input);
  return derivePositionState(input);
}

function canTransitionPosition(from: PositionTransitionInput, to: PositionTransitionInput) {
  const fromState = resolvePositionTransitionState(from);
  const toState = resolvePositionTransitionState(to);
  if (fromState === toState) return fromState === "flat";
  return ALLOWED_POSITION_TRANSITIONS[fromState].includes(toState);
}

function assertPositionTransition(from: PositionTransitionInput, to: PositionTransitionInput) {
  const fromState = resolvePositionTransitionState(from);
  const toState = resolvePositionTransitionState(to);
  if ((fromState === toState && fromState === "flat") || ALLOWED_POSITION_TRANSITIONS[fromState].includes(toState)) {
    return {
      from: fromState,
      to: toState
    };
  }
  throw createInvariantError(
    "invalid_position_transition",
    `Invalid position transition: ${fromState}->${toState}`,
    {
      from: fromState,
      to: toState
    }
  );
}

function canTransitionOrder(from: OrderState, to: OrderState) {
  if (from === to) return true;
  return ALLOWED_ORDER_TRANSITIONS[from].includes(to);
}

function assertOrderTransition(from: OrderState, to: OrderState) {
  if (from === to || ALLOWED_ORDER_TRANSITIONS[from].includes(to)) {
    return { from, to };
  }
  throw createInvariantError(
    "invalid_order_transition",
    `Invalid order transition: ${from}->${to}`,
    {
      from,
      to
    }
  );
}

module.exports = {
  assertOrderTransition,
  assertPositionTransition,
  canTransitionOrder,
  canTransitionPosition
};
