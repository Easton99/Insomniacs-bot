import { describe, it, expect } from 'vitest';

// Placeholder arithmetic helpers that will live in a stats service (Phase 4).
// Having them here keeps the test runner happy and gives a home for the first
// unit tests listed in the spec.

function calcKD(kills: number, deaths: number): number {
  if (deaths === 0) return kills;
  return Math.round((kills / deaths) * 100) / 100;
}

function calcWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((wins / total) * 10000) / 100;
}

describe('K/D calculation', () => {
  it('divides kills by deaths', () => {
    expect(calcKD(20, 10)).toBe(2);
  });

  it('returns kills when deaths is zero', () => {
    expect(calcKD(15, 0)).toBe(15);
  });

  it('rounds to two decimal places', () => {
    expect(calcKD(10, 3)).toBe(3.33);
  });
});

describe('Win rate calculation', () => {
  it('calculates percentage correctly', () => {
    expect(calcWinRate(6, 10)).toBe(60);
  });

  it('returns 0 when no games played', () => {
    expect(calcWinRate(0, 0)).toBe(0);
  });

  it('handles perfect win rate', () => {
    expect(calcWinRate(10, 10)).toBe(100);
  });
});
