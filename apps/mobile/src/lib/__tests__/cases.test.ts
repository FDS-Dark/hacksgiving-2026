import { describe, expect, it } from '@jest/globals';

import { canMessageResident } from '@/lib/cases';

describe('canMessageResident', () => {
  it('is true only when someone outside staff can read the thread', () => {
    expect(canMessageResident({ source: 'public', requester_id: null })).toBe(true);
    expect(canMessageResident({ source: 'worker', requester_id: 'resident-1' })).toBe(true);
    expect(canMessageResident({ source: 'worker', requester_id: null })).toBe(false);
  });
});
