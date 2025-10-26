import { describe, expect, test } from 'vitest';
import { formatLapTime, formatRaceClock } from '../src/utils/time.js';

describe('formatLapTime', () => {
  test('formats milliseconds into M:SS.mmm', () => {
    expect(formatLapTime(75234)).toBe('1:15.234');
  });

  test('pads seconds and milliseconds correctly', () => {
    expect(formatLapTime(61005)).toBe('1:01.005');
  });

  test('handles invalid input', () => {
    expect(formatLapTime(null)).toBe('--:--.---');
    expect(formatLapTime(NaN)).toBe('--:--.---');
  });
});

describe('formatRaceClock', () => {
  test('formats milliseconds into MM:SS', () => {
    expect(formatRaceClock(183000)).toBe('03:03');
  });

  test('clamps negative values to zero', () => {
    expect(formatRaceClock(-5000)).toBe('00:00');
  });
});
