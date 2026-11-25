export const MAX_TITLE_LENGTH = 100;

/**
 * Key used to detect duplicates: case-, accent- and punctuation-insensitive,
 * ignoring a leading "The". "The Matrix", "the matrix!" and "Matrix" all match.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    // "Part 2" / "pt 2" / "Part Two" all match
    .replace(/\bpt\b/g, 'part')
    .replace(/\b([1-9])\b/g, (d) => NUMBER_WORDS[Number(d)])
    .replace(/^the /, '');
}

const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Edit-distance similarity of two titles after normalising (1 = identical, 0 = nothing alike). */
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

export interface MatchCandidate {
  title: string;
  originalTitle: string;
  voteCount: number;
  popularity: number;
}

export type MatchKind = 'matched' | 'unsure' | 'none';

/** Auto-accept only close, reasonably well-known matches; everything else needs a human. */
const MATCH_THRESHOLD = 0.85;
const UNSURE_THRESHOLD = 0.6;
const PREFIX_THRESHOLD = 0.8;
const MIN_VOTES_FOR_AUTO = 20;
const OBSCURE_PENALTY = 0.2;

/** Similarity of `text` to the first words of a longer title ("harry potter" vs "Harry Potter and the…"). */
function prefixSimilarity(text: string, title: string): number {
  const words = normalizeTitle(text).split(' ').filter(Boolean);
  const titleWords = normalizeTitle(title).split(' ').filter(Boolean);
  // Too short to say a series name was meant ("ok" vs "OK! Madam")
  if (words.join(" ").length < 5 || titleWords.length <= words.length) return 0;
  return titleSimilarity(words.join(' '), titleWords.slice(0, words.length).join(' '));
}

/** How well a title fits what was typed: whole-title or start-of-title similarity (0–1). */
export function matchScore(text: string, title: string): number {
  return Math.max(titleSimilarity(text, title), prefixSimilarity(text, title));
}

/**
 * Orders search results for a menu: the best match first, then close matches
 * (e.g. the rest of a series) in release order, then loosely related films.
 */
export function orderCandidates<T extends MatchCandidate & { id: number; year: number | null }>(
  text: string,
  results: T[],
  best: T | null,
): T[] {
  const close = (r: T) => Math.max(matchScore(text, r.title), matchScore(text, r.originalTitle)) >= PREFIX_THRESHOLD;
  const rest = results.filter((r) => r.id !== best?.id);
  const byYear = (a: T, b: T) => (a.year ?? 9999) - (b.year ?? 9999);
  const ordered = [...rest.filter(close).sort(byYear), ...rest.filter((r) => !close(r))];
  return best ? [best, ...ordered] : ordered;
}

/**
 * Picks the best search result for a line of text and says how confident we are:
 *  matched — near-identical title of a known film (imported automatically)
 *  unsure  — a plausible film but not certain, e.g. a typo or a series name (shown for review)
 *  none    — probably chat, not a film
 * Near-empty database entries (few votes) are ranked below real, well-known films.
 */
export function classifyMatch<T extends MatchCandidate>(
  text: string,
  results: T[],
): { kind: MatchKind; best: T | null; score: number } {
  let best: T | null = null;
  let bestRank = -Infinity;
  let score = 0;
  let prefix = 0;
  for (const r of results) {
    const full = Math.max(titleSimilarity(text, r.title), titleSimilarity(text, r.originalTitle));
    const pre = Math.max(prefixSimilarity(text, r.title), prefixSimilarity(text, r.originalTitle));
    const rank = Math.max(full, pre * 0.9) - (r.voteCount < MIN_VOTES_FOR_AUTO ? OBSCURE_PENALTY : 0);
    if (rank > bestRank + 1e-9 || (Math.abs(rank - bestRank) < 1e-9 && best && r.popularity > best.popularity)) {
      best = r;
      bestRank = rank;
      score = full;
      prefix = pre;
    }
  }
  if (!best) return { kind: 'none', best: null, score: 0 };
  if (score >= MATCH_THRESHOLD && best.voteCount >= MIN_VOTES_FOR_AUTO) return { kind: 'matched', best, score };
  if (score >= UNSURE_THRESHOLD || prefix >= PREFIX_THRESHOLD) return { kind: 'unsure', best, score: Math.max(score, prefix) };
  return { kind: 'none', best, score };
}

/**
 * Extra searches to try when the first search finds nothing convincing — the
 * movie database doesn't forgive typos, but searching on part of the text often
 * finds the right film ("potter" for "Harrpy potter", "interste" for "interstelar").
 */
export function fallbackQueries(text: string): string[] {
  const words = normalizeTitle(text).split(' ').filter((w) => w.length >= 4);
  const queries = [...words].sort((a, b) => b.length - a.length).slice(0, 2);
  if (words.length === 1 && words[0].length >= 6) queries.push(words[0].slice(0, Math.ceil(words[0].length * 0.7)));
  return [...new Set(queries)].filter((q) => q !== normalizeTitle(text));
}

/** Tidies a title typed by a user: collapses whitespace and trims. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

const URL_RE = /https?:\/\/\S+/gi;
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const MENTION_RE = /<(@[!&]?|#)\d+>/g;
const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu;
const BULLET_RE = /^(?:[-*•–—>]+|\d{1,3}[.)])\s+/;
const MARKDOWN_RE = /(\*\*|__|~~|\|\||`)/g;

/**
 * Extracts likely movie titles from a channel message for the one-time import.
 * Each non-empty line is treated as a title after stripping bullets, numbering,
 * markdown, links, mentions and emoji. Lines that look like chat (too long, or
 * ending in a question mark) are skipped. Results are reviewed before saving.
 */
export function parseMovieLines(content: string): string[] {
  const titles: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    let line = raw
      .replace(URL_RE, ' ')
      .replace(CUSTOM_EMOJI_RE, ' ')
      .replace(MENTION_RE, ' ')
      .replace(EMOJI_RE, ' ')
      .replace(MARKDOWN_RE, '')
      .trim();
    line = line.replace(BULLET_RE, '').trim();
    line = line.replace(/^[\s\-–—:|,.]+|[\s\-–—:|,]+$/g, '').trim();
    line = cleanTitle(line);

    if (line.length < 2 || line.length > MAX_TITLE_LENGTH) continue;
    if (line.endsWith('?')) continue;
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    titles.push(line);
  }
  return titles;
}
