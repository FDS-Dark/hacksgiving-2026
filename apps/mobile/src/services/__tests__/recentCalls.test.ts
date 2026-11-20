import { describe, expect, it } from '@jest/globals';

import { milesBetween, parseRecentCalls } from '@/services/recentCalls';

describe('recent calls', () => {
  it('keeps safety-related calls with coordinates and generalizes their location', () => {
    const html = `
      <table><tr>
        <td>P2611200764</td><td>11/20/2026 01:16 PM</td>
        <td>LL(-87:56:21.7537,43:04:08.1372): EST 2760 N 22ND ST MKE</td>
        <td>5</td><td>Shooting</td><td>Service in Progress</td>
      </tr><tr>
        <td>P2611200761</td><td>11/20/2026 01:13 PM</td>
        <td>LL(-87:56:21.7537,43:04:08.1372): EST 2760 N 22ND ST MKE</td>
        <td>5</td><td>911</td><td>Service in Progress</td>
      </tr></table>`;

    expect(parseRecentCalls(html)).toEqual([
      expect.objectContaining({
        id: 'P2611200764',
        nature: 'Shooting',
        latitude: 43.069,
        longitude: -87.939,
      }),
    ]);
  });

  it('calculates proximity in miles', () => {
    const miles = milesBetween(
      { latitude: 43.045, longitude: -87.95 },
      { latitude: 43.055, longitude: -87.95 },
    );
    expect(miles).toBeGreaterThan(0.6);
    expect(miles).toBeLessThan(0.8);
  });

  it('keeps a safety alert even when the city row has no embedded coordinates', () => {
    const html = `<table><tr><td>P2611200904</td><td>11/20/2026 02:47 PM</td><td>2300 W HIGHLAND BLVD MKE</td><td>3</td><td>Sexual Assault</td><td>Advised</td></tr></table>`;
    expect(parseRecentCalls(html)).toEqual([
      expect.objectContaining({ id: 'P2611200904', nature: 'Sexual Assault', district: '3' }),
    ]);
  });
});
