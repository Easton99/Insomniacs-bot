import { config } from '../config';
import logger from '../utils/logger';

/**
 * Movie metadata lookups.
 *  - TMDB (themoviedb.org): search + official titles, year, poster, IMDb id
 *  - OMDb (omdbapi.com):     IMDb rating + Rotten Tomatoes score by IMDb id
 * Both are optional: without keys, movies are stored exactly as typed.
 */

const TMDB_API = 'https://api.themoviedb.org/3';
const OMDB_API = 'https://www.omdbapi.com/';
const TIMEOUT_MS = 4000;

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

export interface TmdbMovie {
  id: number;
  title: string;
  originalTitle: string;
  year: number | null;
  posterPath: string | null;
  popularity: number;
  voteCount: number;
}

export interface TmdbDetails extends TmdbMovie {
  imdbId: string | null;
}

export interface Ratings {
  imdbRating: string | null; // e.g. "8.5"
  rtRating: string | null; // e.g. "92%" — OMDb rarely returns this any more
  metascore: string | null; // e.g. "74"
}

export function isTmdbConfigured(): boolean {
  return Boolean(config.TMDB_API_KEY);
}

export function isOmdbConfigured(): boolean {
  return Boolean(config.OMDB_API_KEY);
}

/** Accepts either a v3 API key or a v4 "API Read Access Token" (a JWT). */
async function tmdbGet<T>(path: string, params: Record<string, string> = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const key = config.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY not configured');
  const isToken = key.startsWith('eyJ');
  const url = new URL(`${TMDB_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!isToken) url.searchParams.set('api_key', key);

  const res = await fetch(url, {
    headers: isToken ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
  return (await res.json()) as T;
}

interface RawTmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  popularity?: number;
  vote_count?: number;
  imdb_id?: string | null;
}

function toMovie(r: RawTmdbMovie): TmdbMovie {
  const year = r.release_date ? Number.parseInt(r.release_date.slice(0, 4), 10) : NaN;
  return {
    id: r.id,
    title: r.title,
    originalTitle: r.original_title ?? r.title,
    year: Number.isFinite(year) ? year : null,
    posterPath: r.poster_path ?? null,
    popularity: r.popularity ?? 0,
    voteCount: r.vote_count ?? 0,
  };
}

export async function searchMovies(query: string, limit = 10, timeoutMs = TIMEOUT_MS): Promise<TmdbMovie[]> {
  const q = query.trim();
  if (!q || !isTmdbConfigured()) return [];
  const data = await tmdbGet<{ results?: RawTmdbMovie[] }>(
    '/search/movie',
    { query: q, include_adult: 'false', language: 'en-GB', page: '1' },
    timeoutMs,
  );
  return (data.results ?? []).slice(0, limit).map(toMovie);
}

export async function getMovieDetails(tmdbId: number): Promise<TmdbDetails | null> {
  if (!isTmdbConfigured()) return null;
  try {
    const r = await tmdbGet<RawTmdbMovie>(`/movie/${tmdbId}`, { language: 'en-GB' });
    return { ...toMovie(r), imdbId: r.imdb_id || null };
  } catch (err) {
    logger.warn({ err, tmdbId }, 'TMDB details lookup failed');
    return null;
  }
}

export interface MovieInfo extends TmdbDetails {
  overview: string | null;
  tagline: string | null;
  runtime: number | null; // minutes
  genres: string[];
  backdropPath: string | null;
  director: string | null;
  cast: string[];
  trailerUrl: string | null;
}

interface RawVideo { key: string; site: string; type: string; official?: boolean }

/** Full film details for the info card: plot, runtime, genres, director, cast and a YouTube trailer. */
export async function getMovieInfo(tmdbId: number): Promise<MovieInfo | null> {
  if (!isTmdbConfigured()) return null;
  try {
    const r = await tmdbGet<RawTmdbMovie & {
      overview?: string;
      tagline?: string;
      runtime?: number;
      genres?: { name: string }[];
      backdrop_path?: string | null;
      videos?: { results?: RawVideo[] };
      credits?: { cast?: { name: string; order?: number }[]; crew?: { name: string; job: string }[] };
    }>(`/movie/${tmdbId}`, { language: 'en-GB', append_to_response: 'videos,credits', include_video_language: 'en,null' });

    const videos = (r.videos?.results ?? []).filter((v) => v.site === 'YouTube');
    const trailer =
      videos.find((v) => v.type === 'Trailer' && v.official) ??
      videos.find((v) => v.type === 'Trailer') ??
      videos.find((v) => v.type === 'Teaser');

    return {
      ...toMovie(r),
      imdbId: r.imdb_id || null,
      overview: r.overview?.trim() || null,
      tagline: r.tagline?.trim() || null,
      runtime: r.runtime || null,
      genres: (r.genres ?? []).map((g) => g.name),
      backdropPath: r.backdrop_path ?? null,
      director: r.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null,
      cast: (r.credits?.cast ?? []).slice(0, 4).map((c) => c.name),
      trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    };
  } catch (err) {
    logger.warn({ err, tmdbId }, 'TMDB info lookup failed');
    return null;
  }
}

export function tmdbUrl(tmdbId: number): string {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}

export function backdropUrl(path: string | null | undefined): string | null {
  return path ? `https://image.tmdb.org/t/p/w780${path}` : null;
}

export async function getRatings(imdbId: string): Promise<Ratings | null> {
  if (!isOmdbConfigured()) return null;
  try {
    const url = new URL(OMDB_API);
    url.searchParams.set('apikey', config.OMDB_API_KEY ?? '');
    url.searchParams.set('i', imdbId);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`OMDb ${res.status}`);
    const data = (await res.json()) as {
      Response?: string;
      Error?: string;
      imdbRating?: string;
      Metascore?: string;
      Ratings?: { Source: string; Value: string }[];
    };
    if (data.Response !== 'True') {
      logger.warn({ imdbId, error: data.Error }, 'OMDb lookup returned no data');
      return null;
    }
    const value = (v: string | undefined) => (v && v !== 'N/A' ? v : null);
    const rt = data.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value ?? null;
    const meta = value(data.Metascore) ?? data.Ratings?.find((r) => r.Source === 'Metacritic')?.Value.split('/')[0] ?? null;
    return { imdbRating: value(data.imdbRating), rtRating: rt, metascore: meta };
  } catch (err) {
    logger.warn({ err, imdbId }, 'OMDb ratings lookup failed');
    return null;
  }
}

export function imdbUrl(imdbId: string): string {
  return `https://www.imdb.com/title/${imdbId}/`;
}

/** OMDb doesn't give a reliable Rotten Tomatoes URL, so link to RT's search. */
export function rottenTomatoesUrl(title: string): string {
  return `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;
}

export function posterUrl(posterPath: string | null | undefined): string | null {
  return posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : null;
}
