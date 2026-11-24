import { describe, expect, it } from 'vitest';
import { normalizeTitle, parseMovieLines } from '../movie-utils';

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
