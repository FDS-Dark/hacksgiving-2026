import { describe, expect, it } from '@jest/globals';

import { soft } from '@/components/staff/kit';

describe('soft', () => {
  it('adds alpha to a hex color and leaves other colors alone', () => {
    expect(soft('#0F6B3A', 0.5)).toBe('#0F6B3A80');
    expect(soft('rgba(0,0,0,0.1)')).toBe('rgba(0,0,0,0.1)');
  });
});
