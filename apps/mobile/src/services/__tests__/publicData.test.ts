import { describe, expect, it } from '@jest/globals';

import type { CrimeTrendPoint } from '@/api/types';
import { sourceLabel, yearOverYear } from '@/services/publicData';

const point = (month: string, value: number): CrimeTrendPoint => ({
  offense: 'violent-crime', measure: 'actual', series: 'Milwaukee Police Department', month, value,
});

describe('public data presentation', () => {
  it('compares two complete 12-month periods', () => {
    const points = Array.from({ length: 24 }, (_, index) => point(
      `202${index < 12 ? 4 : 5}-${String((index % 12) + 1).padStart(2, '0')}-01`, index < 12 ? 10 : 12,
    ));
    expect(yearOverYear(points)).toEqual({ current: 144, previous: 120, percentChange: 20, latestMonth: '2025-12-01' });
  });

  it('does not claim a year comparison from partial data', () => {
    expect(yearOverYear([point('2025-01-01', 12)])).toBeNull();
  });

  it('turns ingestion keys into resident-friendly source names', () => {
    expect(sourceLabel('mfd_calls')).toBe('MFD fire & EMS calls');
  });
});
