import { describe, expect, it } from 'vitest';
import { classifyMatch, fallbackQueries, normalizeTitle, parseMovieLines, titleSimilarity } from '../movie-utils';

describe('fallbackQueries', () => {
  it('searches on the longest words of a multi-word line', () => {
    expect(fallbackQueries('Harrpy potter')).toEqual(['harrpy', 'potter']);
  });
  it('searches on the start of a single long word', () => {
    expect(fallbackQueries('interstelar')).toEqual(['interstelar'.slice(0, 8)]);
  });
  it('has nothing extra for short single words', () => {
    expect(fallbackQueries('Heat')).toEqual([]);
  });
});

const film = (title: string, voteCount = 5000, popularity = 50) => ({ title, originalTitle: title, voteCount, popularity });

describe('titleSimilarity', () => {
  it('is 1 for the same title written differently', () => {
    expect(titleSimilarity('dune part two', 'Dune: Part Two')).toBe(1);
  });
  it('tolerates small typos', () => {
    expect(titleSimilarity('Interstelar', 'Interstellar')).toBeGreaterThan(0.9);
  });
  it('is low for unrelated text', () => {
    expect(titleSimilarity('lol same', 'Dune')).toBeLessThan(0.3);
  });
});

describe('classifyMatch', () => {
  it('auto-matches a near-identical, well-known film', () => {
    const r = classifyMatch('dune part 2', [film('Dune: Part Two'), film('Dune')]);
    expect(r.kind).toBe('matched');
    expect(r.best?.title).toBe('Dune: Part Two');
  });
  it('flags a franchise name as unsure rather than guessing a film', () => {
    const r = classifyMatch('Harry Potter', [film('Harry Potter and the Philosopher\'s Stone')]);
    expect(r.kind).not.toBe('matched');
  });
  it('does not auto-match obscure films with chat-like names', () => {
    expect(classifyMatch('same', [film('Same', 3)]).kind).toBe('unsure');
  });
  it('returns none when nothing comes back', () => {
    expect(classifyMatch('has anyone seen it', []).kind).toBe('none');
  });
  it('treats a series name or misspelt series as a best guess', () => {
    const results = [film('Harry Potter and the Goblet of Fire', 22994, 40), film('Harry Potter and the Philosopher\'s Stone', 30686, 80)];
    expect(classifyMatch('Harry Potter', results).kind).toBe('unsure');
    expect(classifyMatch('Harrpy potter', results).kind).toBe('unsure');
  });
  it('prefers a well-known film over a near-empty exact-title entry', () => {
    const r = classifyMatch('interstelar', [film('Interstelar', 0, 1), film('Interstellar', 35000, 120)]);
    expect(r.best?.title).toBe('Interstellar');
    expect(r.kind).toBe('matched');
  });
  it('prefers the more popular film when titles tie', () => {
    const r = classifyMatch('Dune', [film('Dune', 4000, 20), film('Dune', 12000, 90)]);
    expect(r.best?.popularity).toBe(90);
  });
});

describe('normalizeTitle', () => {
  it('ignores case, punctuation, accents and a leading "The"', () => {
    expect(normalizeTitle('The Matrix')).toBe(normalizeTitle('matrix!'));
    expect(normalizeTitle('Amélie')).toBe('amelie');
    expect(normalizeTitle('Fast & Furious')).toBe(normalizeTitle('Fast and Furious'));
  });
  it('keeps different films apart', () => {
    expect(normalizeTitle('Alien')).not.toBe(normalizeTitle('Aliens'));
  });
});

describe('parseMovieLines', () => {
  it('splits multi-line messages and strips bullets and numbering', () => {
    expect(parseMovieLines('- Dune\n* Arrival\n1. Heat\n2) Se7en')).toEqual(['Dune', 'Arrival', 'Heat', 'Se7en']);
  });
  it('does not treat a numeric title as numbering', () => {
    expect(parseMovieLines('1917')).toEqual(['1917']);
    expect(parseMovieLines('2001: A Space Odyssey')).toEqual(['2001: A Space Odyssey']);
  });
  it('removes markdown, links, mentions and emoji', () => {
    expect(parseMovieLines('**Interstellar** 🚀 https://www.imdb.com/title/tt0816692/')).toEqual(['Interstellar']);
    expect(parseMovieLines('<@123456789> Paddington 2 <:kek:987654321>')).toEqual(['Paddington 2']);
  });
  it('skips link-only lines, questions and long chat', () => {
    expect(parseMovieLines('https://letterboxd.com/film/heat/')).toEqual([]);
    expect(parseMovieLines('has anyone seen this one?')).toEqual([]);
    expect(parseMovieLines('x'.repeat(150))).toEqual([]);
    expect(parseMovieLines('👍')).toEqual([]);
  });
});
