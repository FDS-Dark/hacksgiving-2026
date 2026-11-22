import { describe, expect, it } from '@jest/globals';

import { bedsLabel, totalBeds } from '@/lib/beds';

const NOW = new Date('2026-11-21T20:00:00Z').getTime();
const twoHoursAgo = '2026-11-21T18:00:00Z';

describe('bed counts', () => {
  it('says how many beds are open and how recent the count is', () => {
    expect(bedsLabel({ beds_available: 12, beds_updated_at: twoHoursAgo }, NOW)).toBe('12 beds open · updated 2h ago');
    expect(bedsLabel({ beds_available: 1, beds_updated_at: twoHoursAgo }, NOW)).toBe('1 bed open · updated 2h ago');
    expect(bedsLabel({ beds_available: 0, beds_updated_at: twoHoursAgo }, NOW)).toBe('No beds open · updated 2h ago');
  });

  it('shows nothing when the count is unknown', () => {
    expect(bedsLabel({ beds_available: null, beds_updated_at: null }, NOW)).toBeNull();
  });

  it('adds up the places that have a count, and is null when none do', () => {
    expect(totalBeds([{ beds_available: 12 }, { beds_available: null }, { beds_available: 3 }])).toBe(15);
    expect(totalBeds([{ beds_available: 0 }])).toBe(0);
    expect(totalBeds([{ beds_available: null }])).toBeNull();
  });
});
