import { describe, expect, it } from 'vitest';
import { MIN_POSITION_GAP, POSITION_STEP, positionBetween } from './ranking.js';

describe('positionBetween', () => {
  it('handles empty columns and the two ends', () => {
    expect(positionBetween(null, null)).toBe(POSITION_STEP);
    expect(positionBetween(null, 500)).toBe(500 - POSITION_STEP);
    expect(positionBetween(2000, null)).toBe(2000 + POSITION_STEP);
  });

  it('places cards strictly between neighbours', () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
    const p = positionBetween(1, 1.5)!;
    expect(p).toBeGreaterThan(1);
    expect(p).toBeLessThan(1.5);
  });

  it('asks for a rebalance when the gap is exhausted', () => {
    expect(positionBetween(1, 1 + MIN_POSITION_GAP / 2)).toBeNull();
    // repeatedly inserting at the front of a pair eventually exhausts precision
    let next = 1000;
    let rebalances = 0;
    for (let i = 0; i < 100; i++) {
      const p = positionBetween(0, next);
      if (p === null) { rebalances++; break; }
      next = p;
    }
    expect(rebalances).toBe(1);
  });
});
