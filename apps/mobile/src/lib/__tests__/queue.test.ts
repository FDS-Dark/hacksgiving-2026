import { describe, expect, it } from '@jest/globals';

import type { Case } from '@/api/types';
import { inView, matchesSearch, viewCounts, viewFromParams } from '@/lib/queue';

const base = {
  id: 'x',
  number: 1047,
  title: 'Conflict near N 27th & Wells',
  description: 'Two neighbors arguing',
  location: 'N 27th St',
  status: 'in_progress',
  priority: 'medium',
  assigned_worker_id: 'me',
} as unknown as Case;
const make = (over: Partial<Case>) => ({ ...base, ...over }) as Case;

describe('queue views', () => {
  it('sorts each case into the right chips', () => {
    const cases = [
      make({ id: 'a', priority: 'critical' }),
      make({ id: 'b', status: 'new', assigned_worker_id: null }),
      make({ id: 'c', status: 'resolved' }),
      make({ id: 'd', assigned_worker_id: 'someone' }),
    ];
    expect(viewCounts(cases, 'me')).toEqual({ open: 3, mine: 1, new: 1, unassigned: 1, urgent: 1, closed: 1 });
  });

  it('never counts a closed case as mine or urgent', () => {
    const closed = make({ status: 'closed', priority: 'critical' });
    expect(inView(closed, 'mine', 'me')).toBe(false);
    expect(inView(closed, 'urgent', 'me')).toBe(false);
  });

  it('has no "mine" before we know who you are', () => {
    expect(inView(base, 'mine', undefined)).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('finds by number, with or without #', () => {
    expect(matchesSearch(base, '#1047')).toBe(true);
    expect(matchesSearch(base, '104')).toBe(true);
    expect(matchesSearch(base, '2047')).toBe(false);
  });

  it('finds by words in the title, description or location', () => {
    expect(matchesSearch(base, 'wells')).toBe(true);
    expect(matchesSearch(base, 'neighbors')).toBe(true);
    expect(matchesSearch(base, 'shelter')).toBe(false);
  });
});

describe('viewFromParams', () => {
  it('reads the deep links', () => {
    expect(viewFromParams({ view: 'closed' })).toBe('closed');
    expect(viewFromParams({ urgent: '1', open: '1' } as never)).toBe('urgent');
    expect(viewFromParams({ assigned: 'unassigned' })).toBe('unassigned');
    expect(viewFromParams({ status: 'new' })).toBe('new');
    expect(viewFromParams({})).toBe('open');
  });
});
