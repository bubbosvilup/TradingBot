export type PortfolioKillSwitchMode = "block_entries_only";

const VALID_PORTFOLIO_KILL_SWITCH_MODES = new Set<PortfolioKillSwitchMode>(["block_entries_only"]);

module.exports = {
  VALID_PORTFOLIO_KILL_SWITCH_MODES
};
