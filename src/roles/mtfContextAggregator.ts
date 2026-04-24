// Pure computation — no store writes, no side effects.
// Foundation layer only — not wired into live trading decisions yet.

import type { MarketRegime } from "../types/architect.ts";
import type { MtfFrameSnapshot, MtfHorizonFrameId, MtfSnapshot, MtfTimeframeId } from "../types/mtf.ts";

const REGIMES: readonly MarketRegime[] = ["trend", "range", "volatile", "unclear"];
const MIN_READY_FRAMES = 2;

/**
 * Aggregate an array of per-timeframe frame snapshots into a single MtfSnapshot.
 *
 * Rules:
 * - Fewer than MIN_READY_FRAMES ready frames ⇒ metaRegime "unclear", instability 1.
 * - Otherwise: majority vote among ready frames decides metaRegime.
 *   Ties or no majority ⇒ "unclear".
 * - Instability = 1 − (majorityCount / readyCount). All agree ⇒ 0. No majority ⇒ capped at 1.
 * - Dominant timeframe: highest-confidence frame among those aligned with metaRegime.
 *   When metaRegime is "unclear" and caused by disagreement, no dominant frame is chosen.
 */
function aggregateMtfSnapshots(frames: MtfFrameSnapshot[], now: number): MtfSnapshot {
  const readyFrames = frames.filter(f => f.ready);
  const readyCount = readyFrames.length;

  if (readyCount < MIN_READY_FRAMES) {
    return {
      metaRegime: "unclear",
      dominantTimeframe: null,
      dominantFrame: null,
      instability: 1,
      readyFrameCount: readyCount,
      frames,
      aggregatedAt: now,
    };
  }

  // Count regime votes among ready frames.
  const votes = new Map<MarketRegime, number>();
  for (const regime of REGIMES) {
    votes.set(regime, 0);
  }
  for (const frame of readyFrames) {
    votes.set(frame.regime, (votes.get(frame.regime) ?? 0) + 1);
  }

  // Find majority regime: must have strictly more than any other single regime.
  let bestRegime: MarketRegime = "unclear";
  let bestCount = 0;
  let tied = false;
  for (const regime of REGIMES) {
    const count = votes.get(regime) ?? 0;
    if (count > bestCount) {
      bestRegime = regime;
      bestCount = count;
      tied = false;
    } else if (count === bestCount && count > 0) {
      tied = true;
    }
  }

  // Tie or best is "unclear" with low count ⇒ resolve as unclear.
  const metaRegime: MarketRegime = tied ? "unclear" : bestRegime;
  const majorityCount = tied ? 0 : bestCount;

  // Instability: 0 when all agree, approaches 1 as agreement drops.
  const instability = majorityCount > 0
    ? 1 - (majorityCount / readyCount)
    : 1;

  // Dominant timeframe: highest confidence among frames aligned with metaRegime.
  let dominantTimeframe: MtfTimeframeId | null = null;
  let dominantFrame: MtfHorizonFrameId | null = null;
  if (metaRegime !== "unclear") {
    let bestConfidence = -1;
    for (const frame of readyFrames) {
      if (frame.regime === metaRegime && frame.confidence > bestConfidence) {
        bestConfidence = frame.confidence;
        dominantTimeframe = frame.timeframe;
        dominantFrame = frame.horizonFrame;
      }
    }
  }

  return {
    metaRegime,
    dominantTimeframe,
    dominantFrame,
    instability,
    readyFrameCount: readyCount,
    frames,
    aggregatedAt: now,
  };
}

module.exports = {
  aggregateMtfSnapshots,
};
