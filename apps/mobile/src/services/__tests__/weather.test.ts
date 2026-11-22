import { describe, expect, it } from '@jest/globals';

import type { WeatherAlert } from '@/api/types';
import { activeAlerts, inEffect, needsShelter } from '@/services/weather';

const NOW = new Date('2026-11-21T18:00:00Z').getTime();

const alert = (overrides: Partial<WeatherAlert>): WeatherAlert => ({
  id: 'a',
  event: 'Wind Chill Advisory',
  headline: null,
  severity: 'Moderate',
  urgency: null,
  area: 'Milwaukee',
  description: 'Wind chills as low as 20 below zero.',
  instruction: null,
  url: null,
  effective_at: '2026-11-21T12:00:00Z',
  expires_at: '2026-11-22T12:00:00Z',
  ...overrides,
});

describe('weather alerts', () => {
  it('is in effect between its start and its end', () => {
    expect(inEffect(alert({}), NOW)).toBe(true);
    expect(inEffect(alert({ effective_at: '2026-11-21T20:00:00Z' }), NOW)).toBe(false);
    expect(inEffect(alert({ expires_at: '2026-11-21T17:00:00Z' }), NOW)).toBe(false);
    expect(inEffect(alert({ effective_at: null, expires_at: null }), NOW)).toBe(true);
  });

  it('puts the most severe first, then the newest', () => {
    const list = activeAlerts(
      [
        alert({ id: 'minor', severity: 'Minor' }),
        alert({ id: 'unknown', severity: null }),
        alert({ id: 'severe-old', severity: 'Severe', effective_at: '2026-11-21T06:00:00Z' }),
        alert({ id: 'severe-new', severity: 'Severe', effective_at: '2026-11-21T15:00:00Z' }),
        alert({ id: 'later', severity: 'Extreme', effective_at: '2026-11-22T00:00:00Z' }),
      ],
      NOW,
    );
    expect(list.map((a) => a.id)).toEqual(['severe-new', 'severe-old', 'minor', 'unknown']);
  });

  it('points to shelter for cold and heat, not for wind or flooding', () => {
    expect(needsShelter(alert({ event: 'Extreme Cold Warning' }))).toBe(true);
    expect(needsShelter(alert({ event: 'Winter Storm Warning' }))).toBe(true);
    expect(needsShelter(alert({ event: 'Excessive Heat Warning' }))).toBe(true);
    expect(needsShelter(alert({ event: 'Wind Advisory' }))).toBe(false);
    expect(needsShelter(alert({ event: 'Flood Watch' }))).toBe(false);
  });
});
