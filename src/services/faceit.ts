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

export async function getPlayerByNickname(nickname: string): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(`/players?nickname=${encodeURIComponent(nickname)}&game=cs2`);
}

export async function getPlayerById(playerId: string): Promise<FaceitPlayer> {
  return faceitFetch<FaceitPlayer>(`/players/${playerId}`);
}
