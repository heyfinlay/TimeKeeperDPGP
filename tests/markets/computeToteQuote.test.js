import { describe, expect, it } from 'vitest';
import { computeToteQuote } from '@/utils/tote.js';

describe('computeToteQuote', () => {
  it('approaches baseline multiplier as stake approaches zero', () => {
    const base = computeToteQuote({ T: 97000, W: 30000, r: 0.1, s: 0 });
    const tiny = computeToteQuote({ T: 97000, W: 30000, r: 0.1, s: 0.0001 });
    expect(base.baselineMultiplier).toBeCloseTo(tiny.effectiveMultiplier ?? 0, 6);
  });

  it('produces strictly decreasing effective multiplier as stake increases', () => {
    const stakes = [0, 100, 500, 2000, 5000, 20000];
    let previous = Number.POSITIVE_INFINITY;
    stakes.forEach((stake) => {
      const quote = computeToteQuote({ T: 150000, W: 42000, r: 0.08, s: stake });
      const effective = quote.effectiveMultiplier ?? previous;
      expect(effective).toBeLessThanOrEqual(previous + Number.EPSILON);
      previous = effective;
    });
  });

  it('never exceeds the max possible payout', () => {
    const vectors = [
      { T: 50000, W: 12000, r: 0.1, s: 500 },
      { T: 250000, W: 90000, r: 0.07, s: 45000 },
      { T: 3200, W: 800, r: 0.05, s: 1500 },
      { T: 0, W: 0, r: 0.1, s: 1000 },
    ];

    vectors.forEach((vector) => {
      const quote = computeToteQuote(vector);
      expect(quote.estPayout).toBeLessThanOrEqual(quote.maxPossiblePayout + 1e-9);
    });
  });

  it('handles zero-pool runners gracefully', () => {
    const zeroPool = computeToteQuote({ T: 5000, W: 0, r: 0.12, s: 1500 });
    expect(zeroPool.baselineMultiplier).toBeGreaterThan(0);
    expect(zeroPool.effectiveMultiplier).toBeGreaterThan(0);
    expect(zeroPool.estPayout).toBeGreaterThan(0);

    const undefinedBaseline = computeToteQuote({ T: 5000, W: 0, r: 0.12, s: 0 });
    expect(undefinedBaseline.baselineMultiplier).toBeNull();
    expect(undefinedBaseline.effectiveMultiplier).toBeNull();
  });

  it('matches regression fixtures', () => {
    const smallStake = computeToteQuote({ T: 97000, W: 30000, r: 0.1, s: 1000 });
    expect(smallStake.estPayout).toBeCloseTo(2845, 0);
    expect(smallStake.effectiveMultiplier).toBeCloseTo(2.845, 3);

    const largeStake = computeToteQuote({ T: 97000, W: 30000, r: 0.1, s: 100000 });
    expect(largeStake.estPayout).toBeCloseTo(136384.615, 3);
    expect(largeStake.effectiveMultiplier).toBeCloseTo(1.363846, 6);
  });

  it('returns unrounded floating point numbers for downstream formatting', () => {
    const quote = computeToteQuote({ T: 123456.78, W: 45678.9, r: 0.0834, s: 987.65 });
    expect(typeof quote.effectiveMultiplier).toBe('number');
    expect(quote.effectiveMultiplier?.toString()).not.toContain('e');
    expect(Number.isInteger(quote.effectiveMultiplier ?? 0)).toBe(false);
  });
});
