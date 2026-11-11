import { describe, expect, it } from 'vitest';
import { daysUntilBirthday, getZonedDate, isBirthdayOn, isValidBirthday } from '../birthday-utils';

describe('isValidBirthday', () => {
  it('accepts real dates including 29 Feb', () => {
    expect(isValidBirthday(29, 2)).toBe(true);
    expect(isValidBirthday(31, 12)).toBe(true);
  });
  it('rejects impossible dates', () => {
    expect(isValidBirthday(30, 2)).toBe(false);
    expect(isValidBirthday(31, 4)).toBe(false);
    expect(isValidBirthday(0, 1)).toBe(false);
    expect(isValidBirthday(1, 13)).toBe(false);
  });
});

describe('isBirthdayOn', () => {
  it('matches the same day and month', () => {
    expect(isBirthdayOn(11, 11, { year: 2026, month: 11, day: 11 })).toBe(true);
    expect(isBirthdayOn(12, 11, { year: 2026, month: 11, day: 11 })).toBe(false);
  });
  it('observes 29 Feb on 28 Feb in non-leap years only', () => {
    expect(isBirthdayOn(29, 2, { year: 2026, month: 2, day: 28 })).toBe(true);
    expect(isBirthdayOn(29, 2, { year: 2028, month: 2, day: 28 })).toBe(false);
    expect(isBirthdayOn(29, 2, { year: 2028, month: 2, day: 29 })).toBe(true);
  });
});

describe('daysUntilBirthday', () => {
  const today = { year: 2026, month: 11, day: 11 };
  it('is 0 on the day', () => expect(daysUntilBirthday(11, 11, today)).toBe(0));
  it('counts forward within the year', () => expect(daysUntilBirthday(25, 12, today)).toBe(44));
  it('wraps into next year', () => expect(daysUntilBirthday(10, 11, today)).toBe(364));
});

describe('getZonedDate', () => {
  it('converts to the target time zone', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan in Tokyo
    const d = getZonedDate('Asia/Tokyo', new Date(Date.UTC(2026, 11, 31, 23, 30)));
    expect(d).toEqual({ year: 2027, month: 1, day: 1, hour: 8 });
  });
});
