import { describe, expect, it } from '@jest/globals';

import { label, length, sameTime, shift, toMinutes } from '@/lib/quietHours';

describe('quiet hours', () => {
  it('reads and moves clock times, wrapping midnight', () => {
    expect(toMinutes('21:30')).toBe(21 * 60 + 30);
    expect(shift('23:30', 60)).toBe('00:30');
    expect(shift('00:00', -30)).toBe('23:30');
  });

  it('labels times and window lengths across midnight', () => {
    expect(label('21:00')).toBe('9:00 PM');
    expect(label('00:30')).toBe('12:30 AM');
    expect(length('21:00', '07:00')).toBe('10 hours');
    expect(length('22:30', '06:00')).toBe('7.5 hours');
  });

  it('compares times with or without seconds', () => {
    expect(sameTime('21:00', '21:00:00')).toBe(true);
    expect(sameTime('21:00', null)).toBe(false);
  });
});
