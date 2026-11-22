import { describe, expect, it } from '@jest/globals';

import {
  SHIFT_BLOCKS,
  clock,
  firstName,
  matchBlock,
  oncallSubtitle,
  oncallTitle,
  rangeLabel,
  shiftRange,
  shiftSubtitle,
  shiftsOnDay,
  weekStrip,
  type OncallNowLike,
  type ShiftLike,
} from '@/lib/oncall';

// Local-time constructors, so the tests pass in any time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const iso = (d: number, h: number, m = 0) => at(d, h, m).toISOString();
const shift = (name: string | null, from: string, to: string, rank = 1): ShiftLike => ({ display_name: name, starts_at: from, ends_at: to, rank });

const maria = shift('Maria Santos', iso(21, 17), iso(21, 23));
const devon = shift('Devon Harris', iso(21, 23), iso(22, 7));

describe('clock', () => {
  it('drops :00 and uses 12-hour time', () => {
    expect(clock(at(21, 23))).toBe('11 PM');
    expect(clock(at(21, 7, 30))).toBe('7:30 AM');
    expect(clock(at(21, 0))).toBe('12 AM');
    expect(clock(at(21, 12, 5))).toBe('12:05 PM');
  });
});

describe('firstName', () => {
  it('uses the first name, or Someone', () => {
    expect(firstName('Devon Harris')).toBe('Devon');
    expect(firstName(null)).toBe('Someone');
    expect(firstName('  ')).toBe('Someone');
  });
});

describe('on-call card copy', () => {
  const base: OncallNowLike = { on_call: [], next: null, me: { on_call: false, shift: null } };

  it('on call with someone next', () => {
    const now = { on_call: [maria], next: devon, me: { on_call: true, shift: maria } };
    expect(oncallTitle(now)).toBe('You’re on call');
    expect(oncallSubtitle(now)).toBe('Until 11 PM · Devon is next in line');
  });

  it('on call with nobody next', () => {
    expect(oncallSubtitle({ ...base, on_call: [maria], me: { on_call: true, shift: maria } })).toBe('Until 11 PM');
  });

  it('on call without a shift row', () => {
    expect(oncallSubtitle({ ...base, me: { on_call: true, shift: null } })).toBe('On call now');
  });

  it('off call while someone else is on', () => {
    const now = { ...base, on_call: [maria] };
    expect(oncallTitle(now)).toBe('You’re off call');
    expect(oncallSubtitle(now)).toBe('Maria is on call until 11 PM');
  });

  it('nobody on call', () => {
    expect(oncallSubtitle(base)).toBe('Nobody is on call');
  });

  it('a nameless person reads as Someone', () => {
    expect(oncallSubtitle({ ...base, on_call: [shift(null, iso(21, 17), iso(21, 23))] })).toBe('Someone is on call until 11 PM');
  });
});

describe('weekStrip', () => {
  it('starts today and runs seven days across the month end', () => {
    const days = weekStrip(new Date(2026, 10, 27, 15));
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: '2026-11-27', weekday: 'Fri', day: 27 });
    expect(days[6]).toMatchObject({ key: '2026-12-03', weekday: 'Thu', day: 3 });
    expect(days.every((d) => d.date.getHours() === 0)).toBe(true);
  });
});

describe('shiftsOnDay', () => {
  it('includes shifts that run into the day, sorted by start then rank', () => {
    const backup = shift('Tasha Reed', iso(21, 17), iso(21, 23), 2);
    const tomorrow = shift('Sam Lee', iso(22, 7), iso(22, 17));
    expect(shiftsOnDay([devon, backup, tomorrow, maria], at(21, 0))).toEqual([maria, backup, devon]);
    expect(shiftsOnDay([devon, maria, tomorrow], at(22, 0))).toEqual([devon, tomorrow]);
  });

  it('sorts by the instant, whatever offset the API wrote', () => {
    const late = shift('A', '2026-11-21T20:00:00-06:00', '2026-11-21T22:00:00-06:00'); // 02:00Z on the 22nd
    const early = shift('B', '2026-11-22T01:00:00Z', '2026-11-22T03:00:00Z');
    const [first] = shiftsOnDay([late, early], new Date('2026-11-22T01:30:00Z'));
    expect(first).toBe(early);
  });
});

describe('shiftSubtitle', () => {
  it('says who is on now, else the kind of shift', () => {
    expect(shiftSubtitle(maria, at(21, 18))).toBe('On call now');
    expect(shiftSubtitle(devon, at(21, 18))).toBe('Overnight');
    expect(shiftSubtitle(shift('T', iso(21, 7), iso(21, 17)), at(21, 18))).toBe('Day shift');
    expect(shiftSubtitle(shift('T', iso(21, 17), iso(21, 23), 2), at(21, 18))).toBe('Backup · on call now');
    expect(shiftSubtitle(shift('T', iso(22, 17), iso(22, 23), 2), at(21, 18))).toBe('Backup · evening');
  });
});

describe('shift blocks', () => {
  it('are the org boundaries', () => {
    expect(SHIFT_BLOCKS.map((b) => b.label)).toEqual(['7 AM–5 PM', '5 PM–11 PM', '11 PM–7 AM']);
  });

  it('end the next day when they cross midnight', () => {
    const [day, evening, overnight] = SHIFT_BLOCKS;
    expect(shiftRange(at(21, 0), day.startHour, day.endHour)).toEqual({ starts_at: iso(21, 7), ends_at: iso(21, 17) });
    expect(shiftRange(at(21, 0), evening.startHour, evening.endHour)).toEqual({ starts_at: iso(21, 17), ends_at: iso(21, 23) });
    expect(shiftRange(at(21, 0), overnight.startHour, overnight.endHour)).toEqual({ starts_at: iso(21, 23), ends_at: iso(22, 7) });
    expect(shiftRange(at(30, 0), 23, 7)).toEqual({ starts_at: new Date(2026, 10, 30, 23).toISOString(), ends_at: new Date(2026, 11, 1, 7).toISOString() });
  });

  it('match a saved shift back to its block, or none for a custom one', () => {
    expect(matchBlock(devon)?.key).toBe('overnight');
    expect(matchBlock(maria)?.key).toBe('evening');
    expect(matchBlock(shift('X', iso(21, 9), iso(21, 13)))).toBeNull();
    expect(matchBlock(shift('X', iso(21, 7, 30), iso(21, 17)))).toBeNull();
  });

  it('label a range that ends the next day', () => {
    expect(rangeLabel(devon.starts_at, devon.ends_at)).toBe('11 PM – 7 AM (next day)');
    expect(rangeLabel(maria.starts_at, maria.ends_at)).toBe('5 PM – 11 PM');
  });
});
