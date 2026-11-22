import { describe, expect, it } from '@jest/globals';

import { SHADES, shadeOf } from '@/lib/coverage';
import { shareMailto } from '@/services/partners';

describe('shadeOf', () => {
  const values = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  it('puts the lowest in the lightest shade and the highest in the darkest', () => {
    expect(shadeOf(5, values)).toBe(SHADES[0]);
    expect(shadeOf(50, values)).toBe(SHADES[SHADES.length - 1]);
    expect(shadeOf(25, values)).toBe(SHADES[2]);
  });

  it('has no shade without a value', () => {
    expect(shadeOf(null, values)).toBeNull();
    expect(shadeOf(10, [])).toBeNull();
  });
});

describe('shareMailto', () => {
  it('encodes the subject and the message', () => {
    expect(shareMailto('intake@example.org', 'Case #1048', 'Line 1\nWhy: beds & food')).toBe(
      'mailto:intake%40example.org?subject=Case%20%231048&body=Line%201%0AWhy%3A%20beds%20%26%20food',
    );
  });
});
