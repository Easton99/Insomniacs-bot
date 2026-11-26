import { describe, it, expect } from 'vitest';
import { formatUk, parseTime, parseWhen, ukWallTimeToDate, validateWhen } from '../movie-schedule';

// Thursday 26 Nov 2026, 17:00 UK (GMT, so UTC = UK)
const NOW = new Date('2026-11-26T17:00:00Z');

describe('parseTime', () => {
  it('reads 24h, am/pm and bare hours (bare 1–11 = evening)', () => {
    expect(parseTime('20:00')).toEqual([20, 0]);
    expect(parseTime('8pm')).toEqual([20, 0]);
    expect(parseTime('8:30pm')).toEqual([20, 30]);
    expect(parseTime('9')).toEqual([21, 0]);
    expect(parseTime('12am')).toEqual([0, 0]);
    expect(parseTime('11am')).toEqual([11, 0]);
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('soon')).toBeNull();
  });
});

describe('parseWhen (UK time)', () => {
  it('today / tonight / tomorrow', () => {
    expect(parseWhen('today 21:30', NOW)?.toISOString()).toBe('2026-11-26T21:30:00.000Z');
    expect(parseWhen('tonight', NOW)?.toISOString()).toBe('2026-11-26T20:00:00.000Z');
    expect(parseWhen('tomorrow 8pm', NOW)?.toISOString()).toBe('2026-11-27T20:00:00.000Z');
  });

  it('weekday names go to the next one, and to next week if today’s time has passed', () => {
    expect(parseWhen('fri 8pm', NOW)?.toISOString()).toBe('2026-11-27T20:00:00.000Z');
    expect(parseWhen('saturday at 19:45', NOW)?.toISOString()).toBe('2026-11-28T19:45:00.000Z');
    expect(parseWhen('thu 21:00', NOW)?.toISOString()).toBe('2026-11-26T21:00:00.000Z'); // later today
    expect(parseWhen('thu 9am', NOW)?.toISOString()).toBe('2026-12-03T09:00:00.000Z'); // passed → next Thu
  });

  it('dates: dd/mm, dd/mm/yy, yyyy-mm-dd', () => {
    expect(parseWhen('28/11 21:00', NOW)?.toISOString()).toBe('2026-11-28T21:00:00.000Z');
    expect(parseWhen('5/1 20:00', NOW)?.toISOString()).toBe('2027-01-05T20:00:00.000Z'); // already passed this year
    expect(parseWhen('2026-12-05 19:45', NOW)?.toISOString()).toBe('2026-12-05T19:45:00.000Z');
    expect(parseWhen('31/02 20:00', NOW)).toBeNull();
  });

  it('handles British Summer Time (UTC+1)', () => {
    expect(parseWhen('2027-06-04 20:00', NOW)?.toISOString()).toBe('2027-06-04T19:00:00.000Z');
  });

  it('rejects nonsense', () => {
    expect(parseWhen('whenever', NOW)).toBeNull();
    expect(parseWhen('fri at lunch', NOW)).toBeNull();
  });
});

describe('ukWallTimeToDate', () => {
  it('returns null for times that don’t exist when the clocks go forward', () => {
    expect(ukWallTimeToDate(2027, 3, 28, 1, 30)).toBeNull();
  });
});

describe('validateWhen / formatUk', () => {
  it('needs a future time within a year', () => {
    expect(validateWhen(new Date('2026-11-26T16:00:00Z'), NOW)).toMatch(/already passed/);
    expect(validateWhen(new Date('2028-01-01T20:00:00Z'), NOW)).toMatch(/more than a year/);
    expect(validateWhen(null, NOW)).toMatch(/couldn't read/);
    expect(validateWhen(new Date('2026-11-27T20:00:00Z'), NOW)).toBeNull();
  });

  it('formats in UK time', () => {
    expect(formatUk(new Date('2026-11-27T20:00:00Z'))).toBe('Fri 27 Nov, 20:00');
  });
});
