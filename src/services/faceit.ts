import { config } from '../config';
import logger from '../utils/logger';

const BASE_URL = 'https://open.faceit.com/data/v4';

export interface FaceitPlayer {
  player_id: string;
  nickname: string;
  country: string;
  avatar: string;
  games: {
    cs2?: {
      faceit_elo: number;
      skill_level: number;
      region: string;
    };
  };
}

export class FaceitNotFoundError extends Error {
  constructor() {
    super('Player not found');
    this.name = 'FaceitNotFoundError';
  }
}

export class FaceitApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(`FACEIT API error ${status}: ${message}`);
    this.name = 'FaceitApiError';
  }
}

export class FaceitUnconfiguredError extends Error {
  constructor() {
    super('FACEIT_API_KEY is not configured');
    this.name = 'FaceitUnconfiguredError';
  }
}

async function faceitFetch<T>(path: string): Promise<T> {
  if (!config.FACEIT_API_KEY) {
    throw new FaceitUnconfiguredError();
  }

  const url = `${BASE_URL}${path}`;
  logger.debug({ url }, 'FACEIT API request');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.FACEIT_API_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.debug({ status: res.status, path, body }, 'FACEIT API non-OK response');
    if (res.status === 404) throw new FaceitNotFoundError();
    throw new FaceitApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export interface FaceitPlayerStats {
  player_id: string;
  game_id: string;
  lifetime: Record<string, string | string[]>;
}

export interface FaceitMatchHistoryItem {
  match_id: string;
  game_id: string;
  status: string;
  started_at: number;
  finished_at: number;
  teams: Array<{
    faction_id: string;
    players: Array<{ player_id: string; nickname: string }>;
  }>;
  results?: {
    winner: string;
    score: Record<string, number>;
  };
}

export interface FaceitMatchHistory {
  items: FaceitMatchHistoryItem[];
  start: number;
  end: number;
}

export interface FaceitMatchPlayerStats {
  player_id: string;
  nickname: string;
  player_stats: Record<string, string>;
}

export interface FaceitMatchStatsRound {
  match_id: string;
  game_id: string;
  round_stats: Record<string, string>;
  teams: Array<{
    team_id: string;
    premade: boolean;
    team_stats: Record<string, string>;
    players: FaceitMatchPlayerStats[];
  }>;
}

export interface FaceitMatchStats {
  rounds: FaceitMatchStatsRound[];
}

export async function getPlayerByNickname(nickname: string): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}&game=cs2`);
}

export async function getPlayerById(playerId: string): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(`/players/${playerId}`);
}

export async function getPlayerLifetimeStats(playerId: string): Promise<FaceitPlayerStats> {
  return faceitFetch<FaceitPlayerStats>(`/players/${playerId}/stats/cs2`);
}

export async function getPlayerHistory(playerId: string, limit = 10, offset = 0): Promise<FaceitMatchHistory> {
  return faceitFetch<FaceitMatchHistory>(
    `/players/${playerId}/history?game=cs2&limit=${limit}&offset=${offset}`,
  );
}

export async function getMatchStats(matchId: string): Promise<FaceitMatchStats> {
  return faceitFetch<FaceitMatchStats>(`/matches/${matchId}/stats`);
}
