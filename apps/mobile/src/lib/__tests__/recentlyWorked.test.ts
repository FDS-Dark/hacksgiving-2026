import { describe, expect, it } from '@jest/globals';

import { agoInWords, modeFromParams, sortRecentlyWorked, workedLabel } from '@/lib/queue';

const NOW = Date.parse('2026-11-22T15:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe('sortRecentlyWorked', () => {
  it('puts the case I touched last first', () => {
    const cases = [
      { number: 1001, worked_at: ago(240) },
      { number: 1002, worked_at: ago(10) },
      { number: 1003, worked_at: ago(60) },
    ];
    expect(sortRecentlyWorked(cases).map((c) => c.number)).toEqual([1002, 1003, 1001]);
  });

  it('breaks a tie by the newer case and leaves the input alone', () => {
    const cases = [
      { number: 1001, worked_at: ago(5) },
      { number: 1009, worked_at: ago(5) },
    ];
    expect(sortRecentlyWorked(cases).map((c) => c.number)).toEqual([1009, 1001]);
    expect(cases[0].number).toBe(1001);
  });
});

describe('workedLabel', () => {
  it('says what I did and when, in words', () => {
    expect(workedLabel({ worked_type: 'note', worked_at: ago(10) }, NOW)).toBe('You added a note 10 min ago');
    expect(workedLabel({ worked_type: 'created', worked_at: ago(180) }, NOW)).toBe('You opened this 3 hours ago');
    expect(workedLabel({ worked_type: 'reply', worked_at: ago(0) }, NOW)).toBe('You updated this just now');
  });

  it('counts days', () => {
    expect(agoInWords(ago(60 * 24), NOW)).toBe('1 day ago');
    expect(agoInWords(ago(60 * 48), NOW)).toBe('2 days ago');
  });
});

describe('modeFromParams', () => {
  it('opens Recently worked from a link, and falls back to the views', () => {
    expect(modeFromParams({ view: 'recent' })).toBe('recent');
    expect(modeFromParams({ view: 'mine' })).toBe('mine');
    expect(modeFromParams({})).toBe('open');
  });
});
