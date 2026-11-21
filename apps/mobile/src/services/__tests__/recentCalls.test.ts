import { describe, expect, it } from '@jest/globals';

import type { MpdCalls } from '@/api/types';
import { isAlertCall, milesBetween, toCallFeed } from '@/services/recentCalls';

const summary = {
  hours: 2, total: 2, mapped: 1, by_category: [], by_nature: [], by_district: [], by_hour: [],
};

describe('recent calls', () => {
  it('maps the API feed, keeping missing coordinates undefined', () => {
    const data: MpdCalls = {
      calls: [
        {
          call_number: 'P2611200764', dispatched_at: '2026-11-20T19:16:00Z', block: '2700 block of N 22ND ST',
          district: '5', nature: 'Shooting', status: 'Service in Progress', category: 'weapons',
          latitude: 43.069, longitude: -87.939,
        },
        {
          call_number: 'P2611200761', dispatched_at: '2026-11-20T19:13:00Z', block: 'INT 43 S',
          district: 'CITY', nature: 'Traffic Stop', status: 'Advised', category: 'traffic',
          latitude: null, longitude: null,
        },
      ],
      summary,
      last_updated_at: '2026-11-20T20:00:00Z',
      stale: false,
      source: 'https://itmdapps.milwaukee.gov/MPDCallData/',
    };

    const feed = toCallFeed(data);
    expect(feed.calls[0]).toEqual(expect.objectContaining({
      id: 'P2611200764', category: 'weapons', latitude: 43.069, longitude: -87.939, block: '2700 block of N 22ND ST',
    }));
    expect(feed.calls[1].latitude).toBeUndefined();
    expect(feed.lastUpdatedAt).toBe('2026-11-20T20:00:00Z');
  });

  it('alerts on crime and danger, not routine calls', () => {
    expect(isAlertCall({ category: 'weapons', nature: 'ShotSpotter' })).toBe(true);
    expect(isAlertCall({ category: 'traffic', nature: 'Reckless Vehicle' })).toBe(true);
    expect(isAlertCall({ category: 'traffic', nature: 'Traffic Stop' })).toBe(false);
    expect(isAlertCall({ category: 'other', nature: '911' })).toBe(false);
  });

  it('calculates proximity in miles', () => {
    const miles = milesBetween(
      { latitude: 43.045, longitude: -87.95 },
      { latitude: 43.055, longitude: -87.95 },
    );
    expect(miles).toBeGreaterThan(0.6);
    expect(miles).toBeLessThan(0.8);
  });
});
