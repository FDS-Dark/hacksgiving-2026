import { describe, expect, it } from '@jest/globals';

import { setTabReplaceAnimation, tabDirection, tabReplaceAnimation } from '../tabDirection';

describe('tabDirection', () => {
  it('slides in from the right for a tab to the right', () => {
    expect(tabDirection(0, 1)).toBe('push');
    expect(tabDirection(1, 4)).toBe('push');
  });

  it('slides in from the left for a tab to the left', () => {
    expect(tabDirection(1, 0)).toBe('pop');
    expect(tabDirection(4, 2)).toBe('pop');
  });

  it('falls back to the normal slide when no tab is active', () => {
    expect(tabDirection(-1, 0)).toBe('push');
  });

  it('remembers the last direction for the layouts to read', () => {
    setTabReplaceAnimation('pop');
    expect(tabReplaceAnimation()).toBe('pop');
    setTabReplaceAnimation('push');
    expect(tabReplaceAnimation()).toBe('push');
  });
});
