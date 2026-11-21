import { describe, expect, it } from '@jest/globals';

import type { DispatchCall, IncidentPoint } from '@/api/types';
import { toSafetyPoints } from '@/services/publicSafety';
import { milesBetween, toRecentCalls } from '@/services/recentCalls';

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
