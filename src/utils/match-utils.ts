import type { FaceitMatchStats, FaceitMatchPlayerStats } from '../services/faceit';

export interface ProcessedMatch {
  map: string;
  result: 'W' | 'L';
  playerScore: string;
  opponentScore: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: string;
  hsPercent: number;
  startedAt: number;
}

export function formatMapName(map: string): string {
  return map
    .replace(/^de_|^cs_|^ar_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function processMatchStats(
  matchStats: FaceitMatchStats,
  playerId: string,
  startedAt: number,
): ProcessedMatch | null {
  const round = matchStats.rounds[0];
  if (!round) return null;

  let playerEntry: FaceitMatchPlayerStats | undefined;
  let playerTeamScore: string | undefined;
  let opponentTeamScore: string | undefined;

  for (const team of round.teams) {
    const found = team.players.find((p) => p.player_id === playerId);
    if (found) {
      playerEntry = found;
      playerTeamScore = team.team_stats['Final Score'];
    } else {
      opponentTeamScore = team.team_stats['Final Score'];
    }
  }

  if (!playerEntry) return null;

  const ps = playerEntry.player_stats;

  return {
    map: formatMapName(round.round_stats['Map'] ?? 'Unknown'),
    result: ps['Result'] === '1' ? 'W' : 'L',
    playerScore: playerTeamScore ?? '?',
    opponentScore: opponentTeamScore ?? '?',
    kills: parseInt(ps['Kills'] ?? '0', 10),
    deaths: parseInt(ps['Deaths'] ?? '0', 10),
    assists: parseInt(ps['Assists'] ?? '0', 10),
    kd: ps['K/D Ratio'] ?? '?',
    hsPercent: parseInt(ps['Headshots %'] ?? '0', 10),
    startedAt,
  };
}
