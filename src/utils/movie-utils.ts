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
    .replace(/^the /, '');
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
