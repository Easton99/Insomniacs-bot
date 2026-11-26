import { describe, it, expect } from 'vitest';
import { bestPeak, formatPeak, peakFromHistory } from '../peak-elo';

const now = new Date('2026-11-26T20:00:00Z');
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('peakFromHistory', () => {
  it('rebuilds the rating backwards and finds the highest point', () => {
    // Current 2000. Newest match −30 → before it: 2030. Then +25 → before that: 2005.
    const peak = peakFromHistory(
      2000,
      [
        { eloChange: -30, startedAt: t('2026-11-25T20:00:00Z') },
        { eloChange: 25, startedAt: t('2026-11-24T20:00:00Z') },
      ],
      now,
    );
    expect(peak.elo).toBe(2030);
    expect(peak.at.toISOString()).toBe('2026-11-25T20:00:00.000Z');
  });

  it('is the current rating when the player is climbing', () => {
    const peak = peakFromHistory(2100, [{ eloChange: 25, startedAt: t('2026-11-25T20:00:00Z') }], now);
    expect(peak).toEqual({ elo: 2100, at: now });
  });

  it('stops at the first match without an ELO change', () => {
    const peak = peakFromHistory(
      2000,
      [
        { eloChange: null, startedAt: t('2026-11-25T20:00:00Z') },
        { eloChange: -500, startedAt: t('2026-11-24T20:00:00Z') }, // would imply 2500, but we can't trust it
      ],
      now,
    );
    expect(peak.elo).toBe(2000);
  });

  it('handles no matches', () => {
    expect(peakFromHistory(1800, [], now).elo).toBe(1800);
  });
});

describe('bestPeak / formatPeak', () => {
  it('keeps the stored peak when it is higher, otherwise the fresh one', () => {
    const stored = { elo: 2200, at: new Date('2026-10-01T00:00:00Z') };
    expect(bestPeak(stored, { elo: 2100, at: now })).toBe(stored);
    expect(bestPeak(stored, { elo: 2300, at: now }).elo).toBe(2300);
    expect(bestPeak(null, { elo: 1500, at: now }).elo).toBe(1500);
  });

  it('says "now" when the player is at their peak, otherwise the UK date', () => {
    expect(formatPeak({ elo: 2100, at: now }, 2100)).toBe('2,100 · now');
    expect(formatPeak({ elo: 2230, at: new Date('2026-11-03T12:00:00Z') }, 2100)).toBe('2,230 · 3 Nov 2026');
  });
});
