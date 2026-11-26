/**
 * Peak ELO. FACEIT's public API only gives the CURRENT ELO, plus each match's ELO change.
 * Walking back from the current ELO through recent matches (newest first) rebuilds the rating
 * after every game; the highest point is the peak over that window. The bot also stores the best
 * it has ever seen per user, so over time this becomes a true all-time peak.
 */
export interface EloMatch {
  eloChange: number | null;
  /** Unix seconds (FACEIT's started_at) */
  startedAt: number;
}

export interface Peak {
  elo: number;
  /** When the player was at that rating (ms since epoch) */
  at: Date;
}

/** `matches` must be newest first. Stops at the first match without an ELO change (can't go further back reliably). */
export function peakFromHistory(currentElo: number, matches: EloMatch[], now = new Date()): Peak {
  let elo = currentElo;
  let peak: Peak = { elo: currentElo, at: now };
  for (const m of matches) {
    if (m.eloChange === null) break;
    elo -= m.eloChange; // rating just before this match = rating after the previous one
    if (elo > peak.elo) peak = { elo, at: new Date(m.startedAt * 1000) };
  }
  return peak;
}

/** The higher of a stored all-time peak and a freshly computed one. */
export function bestPeak(stored: Peak | null, fresh: Peak): Peak {
  return stored && stored.elo >= fresh.elo ? stored : fresh;
}

/** "2,140 · 3 Nov 2026" for the embed field; "2,140 · now" when the player is at their peak. */
export function formatPeak(p: Peak, currentElo: number): string {
  const when = p.elo === currentElo ? 'now' : p.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
  return `${p.elo.toLocaleString('en-GB')} · ${when}`;
}
