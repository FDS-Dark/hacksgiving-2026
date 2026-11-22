import { describe, expect, it } from '@jest/globals';

import type { Resource } from '@/api/types';
import { countLabel, filterPlaces, milesLabel, openToday, rankPlaces } from '@/lib/nearby';

// 2026-11-23 is a Monday; build each weekday from it.
const day = (offset: number) => new Date(2026, 10, 23 + offset, 12);
const MON = day(0);
const TUE = day(1);
const WED = day(2);
const SAT = day(5);
const SUN = day(6);

function place(overrides: Partial<Resource>): Resource {
  return {
    active: true,
    address: null,
    beds_available: null,
    beds_updated_at: null,
    category: 'meal_programs',
    created_at: '2026-11-01T00:00:00Z',
    description: '',
    hours: null,
    id: overrides.name ?? 'x',
    is_sample: false,
    latitude: null,
    longitude: null,
    name: 'Place',
    neighborhood: null,
    phone: null,
    source: 'manual',
    website: null,
    ...overrides,
  };
}

describe('openToday', () => {
  // Real strings from the directory.
  it.each([
    ['Monday-Friday · 11:00AM - 12:00PM', MON, 'yes'],
    ['Monday-Friday · 11:00AM - 12:00PM', SAT, 'no'],
    ['Mon-Fri 9am-5pm', WED, 'yes'],
    ['24/7', SUN, 'yes'],
    ['Daily 2pm-midnight', SUN, 'yes'],
    ['Tuesdays and Saturdays · Tuesday: 4:00PM - 6:00PM; Saturday: 8:30AM - 10:30AM', TUE, 'yes'],
    ['Tuesdays and Saturdays · Tuesday: 4:00PM - 6:00PM; Saturday: 8:30AM - 10:30AM', MON, 'no'],
    ['Sunday - Friday · 11:15AM - 12:45PM', SUN, 'yes'],
    ['Sunday - Friday · 11:15AM - 12:45PM', SAT, 'no'],
    ['Monday through Thursday · Monday through Thursday 1:00PM - 3:00PM', WED, 'yes'],
    ['MON & WED 11:00AM - 2:00PM and TUES & THURS 4:00-6:00PM', TUE, 'yes'],
    ['Tue, Thu 10am-2pm', MON, 'no'],
  ] as const)('%s on day %#', (hours, when, expected) => {
    expect(openToday(hours, when)).toBe(expected);
  });

  it('is unknown without named days, for some-weeks days, and for "call"', () => {
    expect(openToday('1:00PM-3:00PM', MON)).toBe('unknown');
    expect(openToday('Call 414-464-5775 for up to date days/hours', MON)).toBe('unknown');
    expect(openToday('2nd & 4th Saturdays · 7:30 am -11:00 am', SAT)).toBe('unknown');
    expect(openToday('First 4 Tuesdays of a month from 9:00AM-11:00AM', TUE)).toBe('unknown');
    expect(openToday(null, MON)).toBe('unknown');
  });

  it('keeps every-week days next to a some-weeks one', () => {
    const hours = 'Monday, Wednesday, Friday, 1st Saturday · Monday: 9:00am - 12:00PM; 1st Saturday: 9:00AM - 11:00AM';
    expect(openToday(hours, WED)).toBe('yes');
    expect(openToday(hours, SAT)).toBe('unknown');
    expect(openToday(hours, TUE)).toBe('no');
  });

  it('does not read "month" as Monday', () => {
    expect(openToday('2nd Saturday of the month', TUE)).toBe('no');
  });
});

describe('rankPlaces', () => {
  const here = { latitude: 43.04, longitude: -87.91 };
  const near = place({ name: 'Near', latitude: 43.041, longitude: -87.911, hours: 'Saturday' });
  const far = place({ name: 'Far', latitude: 43.2, longitude: -87.91, hours: 'Daily' });
  const nowhere = place({ name: 'Nowhere', hours: 'Daily' });
  const sample = place({ name: 'Sample', latitude: 43.04, longitude: -87.91, hours: 'Daily', is_sample: true });

  it('puts the closest first when the location is known, and samples last', () => {
    const names = rankPlaces([sample, nowhere, far, near], { from: here, now: MON }).map((r) => r.place.name);
    expect(names).toEqual(['Near', 'Far', 'Nowhere', 'Sample']);
  });

  it('puts open-today first without a location', () => {
    const names = rankPlaces([sample, near, far, nowhere], { now: MON }).map((r) => r.place.name);
    expect(names).toEqual(['Far', 'Nowhere', 'Near', 'Sample']);
  });

  it('measures distance only when both ends are known', () => {
    const [first, ...rest] = rankPlaces([near, nowhere], { from: here, now: MON });
    expect(first.miles).toBeLessThan(0.2);
    expect(rest[0].miles).toBeNull();
  });
});

describe('filterPlaces', () => {
  const ranked = rankPlaces(
    [
      place({ name: 'Pantry', hours: 'Monday' }),
      place({ name: 'Shelter', category: 'homelessness', hours: '24/7', neighborhood: 'Walker’s Point' }),
      place({ name: 'Sunday meal', hours: 'Sunday' }),
    ],
    { now: MON },
  );

  it('filters by category, open today and search text', () => {
    expect(filterPlaces(ranked, { category: 'homelessness' }).map((r) => r.place.name)).toEqual(['Shelter']);
    expect(filterPlaces(ranked, { openTodayOnly: true }).map((r) => r.place.name)).toEqual(['Pantry', 'Shelter']);
    expect(filterPlaces(ranked, { query: 'walker' }).map((r) => r.place.name)).toEqual(['Shelter']);
    expect(filterPlaces(ranked, {})).toHaveLength(3);
  });
});

describe('labels', () => {
  it('counts and measures in plain words', () => {
    expect(countLabel(1, false)).toBe('1 place');
    expect(countLabel(12, true)).toBe('12 places open today');
    expect(milesLabel(0.01)).toBe('0.1 mi');
    expect(milesLabel(2.345)).toBe('2.3 mi');
  });
});
