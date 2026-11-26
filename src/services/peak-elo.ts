import { db } from '../database/client';
import { bestPeak, peakFromHistory, type EloMatch, type Peak } from '../utils/peak-elo';
import logger from '../utils/logger';

/**
 * Work out the peak from the matches we already have, keep the all-time best in the DB, and
 * return it. Never throws: a DB hiccup just means the stored peak isn't updated this time.
 */
export async function updatePeakElo(discordId: string, currentElo: number, matchesNewestFirst: EloMatch[]): Promise<Peak> {
  const fresh = peakFromHistory(currentElo, matchesNewestFirst);
  try {
    const row = await db.discordUser.findUnique({ where: { discordId }, select: { peakElo: true, peakEloAt: true } });
    const stored = row?.peakElo != null && row.peakEloAt ? { elo: row.peakElo, at: row.peakEloAt } : null;
    const best = bestPeak(stored, fresh);
    if (!stored || best.elo > stored.elo) {
      await db.discordUser.update({ where: { discordId }, data: { peakElo: best.elo, peakEloAt: best.at } });
    }
    return best;
  } catch (err) {
    logger.warn({ err }, 'Could not read/update stored peak ELO');
    return fresh;
  }
}
