/** Distance between neighbouring positions after a rebalance or an append. */
export const POSITION_STEP = 1000;
/** Below this gap, midpoints stop being reliable and the column is renumbered. */
export const MIN_POSITION_GAP = 1e-3;

/**
 * Position for a card placed between `prev` and `next` (either may be null at the ends).
 * Returns `null` when the gap is too small, meaning the column must be rebalanced first.
 */
export function positionBetween(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return POSITION_STEP;
  if (prev === null) return next! - POSITION_STEP;
  if (next === null) return prev + POSITION_STEP;
  if (next - prev < MIN_POSITION_GAP) return null;
  return (prev + next) / 2;
}
