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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type CalendarDate = { year: number; month: number; day: number };

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd" */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** English format without year, e.g. "14th March" */
export function formatBirthday(day: number, month: number): string {
  return `${ordinal(day)} ${MONTH_NAMES[month - 1]}`;
}

/** English long format, e.g. "Saturday 14th March" */
export function formatLongDate(date: CalendarDate): string {
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
  return `${weekday} ${formatBirthday(date.day, date.month)}`;
}

/** 12-hour English time for a whole hour, e.g. 9 → "9am", 12 → "12pm", 0 → "12am" */
export function formatHour(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 === 0 ? 12 : hour % 12}${suffix}`;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
