import { describe, expect, it } from '@jest/globals';

import type { Opportunity, Resource } from '@/api/types';
import { jobsLine, shelterLine } from '@/lib/homeCounts';

const NOW = new Date('2026-11-21T20:00:00Z').getTime();
const shelter = (beds: number | null) => ({ beds_available: beds }) as Resource;
const job = (created: string, posted: string | null = null) => ({ created_at: created, posted_at: posted }) as Opportunity;

describe('Home support counts', () => {
  it('shows open beds when any shelter has a count', () => {
    expect(shelterLine([shelter(12), shelter(null)])).toBe('12 open beds tonight');
    expect(shelterLine([shelter(1)])).toBe('1 open bed tonight');
    expect(shelterLine([shelter(0)])).toBe('No open beds reported');
  });

  it('falls back to how many shelters there are', () => {
    expect(shelterLine([shelter(null), shelter(null)])).toBe('2 places');
  });

  it('counts postings new this week, by posting date when the source gave one', () => {
    const list = [job('2026-11-20T10:00:00Z'), job('2026-11-21T10:00:00Z', '2026-10-01T00:00:00Z'), job('2026-11-01T00:00:00Z')];
    expect(jobsLine(list, NOW)).toBe('1 new this week');
    expect(jobsLine([job('2026-11-01T00:00:00Z')], NOW)).toBe('1 open');
  });
});
