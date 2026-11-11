export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface ZonedDate {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
}

/** Returns the current calendar date/hour in the given IANA time zone. */
export function getZonedDate(timeZone: string, now: Date = new Date()): ZonedDate {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);

  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

/** Day/month validity, allowing 29 February. */
export function isValidBirthday(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The day a birthday is observed in a given year (29 Feb → 28 Feb in non-leap years). */
export function observedDay(day: number, month: number, year: number): number {
  return month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
}

export function isBirthdayOn(day: number, month: number, date: { year: number; month: number; day: number }): boolean {
  return month === date.month && observedDay(day, month, date.year) === date.day;
}

/** Days from `today` until the next occurrence of the birthday (0 = today). */
export function daysUntilBirthday(day: number, month: number, today: { year: number; month: number; day: number }): number {
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  let year = today.year;
  let next = Date.UTC(year, month - 1, observedDay(day, month, year));
  if (next < todayUtc) {
    year += 1;
    next = Date.UTC(year, month - 1, observedDay(day, month, year));
  }
  return Math.round((next - todayUtc) / 86_400_000);
}

export function formatBirthday(day: number, month: number): string {
  return `${day} ${MONTH_NAMES[month - 1]}`;
}
