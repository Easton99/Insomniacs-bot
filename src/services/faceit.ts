import { config } from '../config';
import logger from '../utils/logger';

const BASE_URL = 'https://open.faceit.com/data/v4';

let rlRemaining: number | null = null;
let rlResetAt: number | null = null; // epoch ms

export function getFaceitRateLimitStatus(): { remaining: number | null; resetsAt: number | null } {
  return { remaining: rlRemaining, resetsAt: rlResetAt };
}

function updateRateLimitHeaders(headers: Headers): void {
  const remaining = headers.get('X-RateLimit-Remaining') ?? headers.get('X-Rate-Limit-Remaining');
  const reset = headers.get('X-RateLimit-Reset') ?? headers.get('X-Rate-Limit-Reset');
  if (remaining !== null) rlRemaining = parseInt(remaining, 10);
  if (reset !== null) rlResetAt = parseInt(reset, 10) * 1000;
}

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

export class FaceitRateLimitError extends Error {
  constructor(public readonly resetsAt: number | null) {
    super('FACEIT API rate limit reached');
    this.name = 'FaceitRateLimitError';
  }
}

async function faceitFetch<T>(path: string): Promise<T> {
  if (!config.FACEIT_API_KEY) {
    throw new FaceitUnconfiguredError();
  }

  if (rlRemaining !== null && rlRemaining <= 0) {
    const now = Date.now();
    if (rlResetAt !== null && now < rlResetAt) {
      throw new FaceitRateLimitError(rlResetAt);
    }
    rlRemaining = null;
    rlResetAt = null;
  }

  const url = `${BASE_URL}${path}`;
  logger.debug({ url }, 'FACEIT API request');

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.FACEIT_API_KEY}`,
      Accept: 'application/json',
    },
  });

  updateRateLimitHeaders(res.headers);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.debug({ status: res.status, path, body }, 'FACEIT API non-OK response');
    if (res.status === 404) throw new FaceitNotFoundError();
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      rlRemaining = 0;
      if (retryAfter) rlResetAt = Date.now() + parseInt(retryAfter, 10) * 1000;
      throw new FaceitRateLimitError(rlResetAt);
    }
    throw new FaceitApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export interface FaceitPlayerStats {
  player_id: string;
  game_id: string;
  lifetime: Record<string, string | string[]>;
}

export interface FaceitMatchHistoryTeam {
  faction_id: string;
  players: Array<{ player_id: string; nickname: string }>;
}

export interface FaceitMatchHistoryItem {
  match_id: string;
  game_id: string;
  status: string;
  started_at: number;
  finished_at: number;
  /** Keyed by faction name, e.g. { faction1: {...}, faction2: {...} } */
  teams: Record<string, FaceitMatchHistoryTeam>;
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
