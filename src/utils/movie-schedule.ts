/**
 * Turns what people type for a movie-night time ("fri 8pm", "tomorrow 20:30", "28/11 21:00",
 * "2026-12-05 19:45", "tonight 9") into a Date. Everything is UK time (Europe/London), handling
 * the GMT/BST switch, because that's when the group plays.
 */
const TZ = 'Europe/London';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** UK wall-clock parts for an instant. */
function ukParts(d: Date): { y: number; m: number; d: number; h: number; mi: number; dow: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    dow: DAYS.indexOf(String(p.weekday).slice(0, 3).toLowerCase()),
  };
}

/** The instant when UK clocks show y-m-d h:mi (tries both GMT and BST offsets and keeps the one that round-trips). */
export function ukWallTimeToDate(y: number, m: number, d: number, h: number, mi: number): Date | null {
  for (const offsetH of [0, 1]) {
    const guess = new Date(Date.UTC(y, m - 1, d, h - offsetH, mi));
    const back = ukParts(guess);
    if (back.y === y && back.m === m && back.d === d && back.h === h && back.mi === mi) return guess;
  }
  return null; // e.g. 01:30 on the night the clocks go forward
}

/** "20:00", "8pm", "8:30pm", "8", "20" → [hour, minute]. Bare numbers 1–11 are taken as pm (it's movie night). */
export function parseTime(s: string): [number, number] | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  if (mi > 59) return null;
  if (m[3] === 'pm' && h < 12) h += 12;
  else if (m[3] === 'am' && h === 12) h = 0;
  else if (!m[3] && !m[2] && h >= 1 && h <= 11) h += 12;
  if (h > 23) return null;
  return [h, mi];
}

export function parseWhen(input: string, now = new Date()): Date | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ at /, ' ');
  const today = ukParts(now);
  let y = today.y;
  let mo = today.m;
  let d = today.d;
  let rest = text;

  const addDays = (n: number) => {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + n));
    y = base.getUTCFullYear();
    mo = base.getUTCMonth() + 1;
    d = base.getUTCDate();
  };

  let m: RegExpMatchArray | null;
  if ((m = text.match(/^(today|tonight) ?(.*)$/))) {
    rest = m[2] || (m[1] === 'tonight' ? '20:00' : '');
  } else if ((m = text.match(/^tomorrow ?(.*)$/))) {
    addDays(1);
    rest = m[1];
  } else if ((m = text.match(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]* ?(.*)$/))) {
    let ahead = (DAYS.indexOf(m[1]) - today.dow + 7) % 7;
    const t = parseTime(m[2] || '20:00');
    // Same weekday but the time has already passed today → next week.
    if (ahead === 0 && t && (t[0] < today.h || (t[0] === today.h && t[1] <= today.mi))) ahead = 7;
    addDays(ahead);
    rest = m[2];
  } else if ((m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ t](.+)$/))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4];
  } else if ((m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))? (.+)$/))) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.y;
    rest = m[4];
    // "28/11" without a year that's already passed means next year.
    if (!m[3] && (mo < today.m || (mo === today.m && d < today.d))) y += 1;
  } else {
    return null;
  }

  const t = parseTime(rest || '20:00');
  if (!t) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const when = ukWallTimeToDate(y, mo, d, t[0], t[1]);
  if (!when || when.getUTCDate() === undefined) return null;
  // Reject impossible dates like 31/02 (Date.UTC rolls them over).
  const check = ukParts(when);
  if (check.d !== d || check.m !== mo) return null;
  return when;
}

/** Discord needs events in the future; we also cap at a year ahead. */
export function validateWhen(when: Date | null, now = new Date()): string | null {
  if (!when) return 'I couldn\'t read that time. Try things like `fri 8pm`, `tomorrow 20:30`, `28/11 21:00` or `2026-12-05 19:45` (UK time).';
  if (when.getTime() < now.getTime() + 2 * 60_000) return 'That time has already passed (or is in the next 2 minutes). Pick a time in the future.';
  if (when.getTime() > now.getTime() + 365 * 86_400_000) return "That's more than a year away. Pick a date within the next year.";
  return null;
}

/** "Fri 28 Nov, 20:00" in UK time. */
export function formatUk(d: Date): string {
  return d.toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
