import { describe, expect, it } from '@jest/globals';

import type { DispatchCall, IncidentPoint } from '@/api/types';
import { toSafetyPoints } from '@/services/publicSafety';
import { categoryOf, milesBetween, toCallFeed, toRecentCalls } from '@/services/recentCalls';

const call = (overrides: Partial<DispatchCall>): DispatchCall => ({
  source: 'mpd_calls',
  call_number: 'P2611200764',
  occurred_at: '2026-11-20T19:16:00Z',
  category: 'Shooting',
  status: 'Service in Progress',
  district: '5',
  city: null,
  latitude: 43.069,
  longitude: -87.939,
  ...overrides,
});

describe('recent calls', () => {
  it('keeps the crime-related calls the API serves, with their generalized location', () => {
    const calls = toRecentCalls([call({}), call({ call_number: 'P2611200761', category: '911' })]);
    expect(calls).toEqual([
      expect.objectContaining({ id: 'P2611200764', nature: 'Shooting', district: '5', latitude: 43.069, longitude: -87.939 }),
    ]);
  });

  it('keeps a call without coordinates (the city row had none)', () => {
    const [only] = toRecentCalls([call({ category: 'Robbery', latitude: null, longitude: null })]);
    expect(only).toEqual(expect.objectContaining({ nature: 'Robbery' }));
    expect(only).not.toHaveProperty('latitude');
  });

  it('calculates proximity in miles', () => {
    const miles = milesBetween({ latitude: 43.045, longitude: -87.95 }, { latitude: 43.055, longitude: -87.95 });
    expect(miles).toBeGreaterThan(0.6);
    expect(miles).toBeLessThan(0.8);
  });
});

describe('the 911 call summary', () => {
  it('groups call types for the map colors', () => {
    expect(categoryOf('Subject With A Weapon')).toBe('weapons');
    expect(categoryOf('Battery/Fight/Assault')).toBe('violent');
    expect(categoryOf('Entry-Vehicle')).toBe('property');
    expect(categoryOf('Traffic Stop')).toBe('traffic');
    expect(categoryOf('Noise Nuisance')).toBe('disorder');
    expect(categoryOf('Resource Needed')).toBe('assist');
    expect(categoryOf('911')).toBe('other');
  });

  it('counts every call in the window by category, type, district and hour', () => {
    const now = new Date('2026-11-21T21:10:00Z');
    const feed = toCallFeed([
      call({ call_number: 'P1', occurred_at: '2026-11-21T21:05:00Z', category: 'Traffic Stop', district: '4' }),
      call({ call_number: 'P2', occurred_at: '2026-11-21T19:50:00Z', category: 'Traffic Stop', district: 'CITY', latitude: null, longitude: null }),
      call({ call_number: 'P3', occurred_at: '2026-11-21T19:55:00Z', category: 'Shooting', district: '4' }),
    ], 3, now.getTime(), now);
    const s = feed.summary;
    expect([s.total, s.mapped]).toEqual([3, 2]);
    expect(s.by_category).toEqual([{ label: 'weapons', count: 1 }, { label: 'traffic', count: 2 }]);
    expect(s.by_nature[0]).toEqual({ label: 'Traffic Stop', count: 2 });
    expect(s.by_district[3]).toEqual({ label: '4', count: 2 });
    expect(s.by_district.at(-1)).toEqual({ label: 'CITY', count: 1 });
    expect(s.by_hour.map((h) => h.count)).toEqual([2, 0, 1]);
    // Every call is in the feed (the alerts filter only applies to the Alerts tab).
    expect(feed.calls.map((c) => c.id)).toEqual(['P1', 'P2', 'P3']);
  });
});

describe('reviewed incidents', () => {
  const incident = (overrides: Partial<IncidentPoint>): IncidentPoint => ({
    incident_at: '2026-11-18T12:00:00Z',
    district: '5',
    latitude: 43.08,
    longitude: -87.91,
    offense_codes: ['13A'],
    category: 'assault',
    weapons: ['HANDGUN', 'UNKNOWN'],
    ...overrides,
  });

  it('become map points in their category, and records outside the categories are left off', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    const points = toSafetyPoints([incident({}), incident({ category: null, offense_codes: ['520'] })], now);
    expect(points).toEqual([
      expect.objectContaining({ category: 'assault', ageInDays: 3, weaponUsed: 'HANDGUN', latitude: 43.08 }),
    ]);
  });
});
