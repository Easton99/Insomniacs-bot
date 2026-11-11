import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysUntilBirthday,
  formatBirthday,
  formatHour,
  formatLongDate,
  getZonedDate,
  isBirthdayOn,
  isValidBirthday,
  ordinal,
} from '../birthday-utils';

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

describe('English formatting', () => {
  it('uses ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st'],
    );
  });
  it('formats birthdays and long dates', () => {
    expect(formatBirthday(14, 3)).toBe('14th March');
    expect(formatLongDate({ year: 2026, month: 11, day: 18 })).toBe('Wednesday 18th November');
  });
  it('formats 12-hour times', () => {
    expect([0, 9, 12, 18].map(formatHour)).toEqual(['12am', '9am', '12pm', '6pm']);
  });
});

describe('addDays', () => {
  it('rolls over months and years', () => {
    expect(addDays({ year: 2026, month: 12, day: 28 }, 7)).toEqual({ year: 2027, month: 1, day: 4 });
    expect(addDays({ year: 2028, month: 2, day: 22 }, 7)).toEqual({ year: 2028, month: 2, day: 29 });
  });
});
