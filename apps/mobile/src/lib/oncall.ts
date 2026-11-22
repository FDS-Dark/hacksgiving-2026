/**
 * On call: the copy on Today's card, shift times, the A3 day strip and the
 * preset shift blocks. Pure, in the device's local time; every helper that
 * depends on the clock takes `now`.
 */

/** The fields of an on-call shift these helpers read. */
export interface ShiftLike {
  display_name: string | null;
  starts_at: string;
  ends_at: string;
  rank: number;
}

/** The fields of GET /oncall/now the card reads. */
export interface OncallNowLike<S extends ShiftLike = ShiftLike> {
  on_call: S[];
  next: S | null;
  me: { on_call: boolean; shift: S | null };
}

/** 23:00 → "11 PM", 7:30 → "7:30 AM". Hand-rolled: Intl's spacing differs between Node and Hermes. */
export function clock(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 || 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Maria Santos" → "Maria"; nobody named → "Someone". */
export function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'Someone';
}

/** "Until 11 PM". */
export function untilLabel(shift: Pick<ShiftLike, 'ends_at'>) {
  return `Until ${clock(shift.ends_at)}`;
}

/** The card's title: "You're on call", or plain "On call" while off. */
export function oncallTitle(now: OncallNowLike) {
  return now.me.on_call ? 'You’re on call' : 'On call';
}

/**
 * The line under it:
 * - on call: "Until 11 PM · Devon is next in line"
 * - off call, someone else on: "You're off call · Maria is on until 11 PM"
 * - nobody: "Nobody is on call"
 */
export function oncallSubtitle(now: OncallNowLike) {
  if (now.me.on_call) {
    const parts = [now.me.shift ? untilLabel(now.me.shift) : 'On call now'];
    if (now.next) parts.push(`${firstName(now.next.display_name)} is next in line`);
    return parts.join(' · ');
  }
  const lead = now.on_call[0];
  if (!lead) return 'Nobody is on call';
  return `You’re off call · ${firstName(lead.display_name)} is on until ${clock(lead.ends_at)}`;
}

// ── Days ─────────────────────────────────────────────────────────────────

/** Local midnight of that day. */
export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight `days` days later (calendar days, so DST-safe). */
export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2026-11-21", a stable key for a local day. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface StripDay {
  key: string;
  date: Date;
  /** "Fri" */
  weekday: string;
  /** 21 */
  day: number;
}

/** A3's strip: seven days starting today. */
export function weekStrip(now: Date, days = 7): StripDay[] {
  const today = startOfDay(now);
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i);
    return { key: dayKey(date), date, weekday: WEEKDAYS[date.getDay()], day: date.getDate() };
  });
}

/** "Sat, Nov 22" */
export function dayLabel(date: Date) {
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** Shifts that overlap a local day (so last night's 11 PM shift still shows at 2 AM), by start then rank. */
export function shiftsOnDay<S extends ShiftLike>(shifts: S[], day: Date): S[] {
  const from = startOfDay(day).getTime();
  const to = addDays(day, 1).getTime();
  return shifts
    .filter((s) => new Date(s.starts_at).getTime() < to && new Date(s.ends_at).getTime() > from)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() || a.rank - b.rank);
}

export function isCurrent(shift: Pick<ShiftLike, 'starts_at' | 'ends_at'>, now: Date) {
  const t = now.getTime();
  return new Date(shift.starts_at).getTime() <= t && new Date(shift.ends_at).getTime() > t;
}

/** The line under a person's name on A3: "On call now", "Day shift", "Evening", "Overnight"; backups say so. */
export function shiftSubtitle(shift: ShiftLike, now: Date) {
  const backup = shift.rank === 2;
  if (isCurrent(shift, now)) return backup ? 'Backup · on call now' : 'On call now';
  const h = new Date(shift.starts_at).getHours();
  const kind = h >= 5 && h < 15 ? 'Day shift' : h >= 15 && h < 21 ? 'Evening' : 'Overnight';
  return backup ? `Backup · ${kind.toLowerCase()}` : kind;
}

// ── Shift blocks (A3's add/edit form) ────────────────────────────────────

export interface ShiftBlock {
  key: 'day' | 'evening' | 'overnight';
  label: string;
  startHour: number;
  endHour: number;
}

/** The org's shift boundaries (07:00, 17:00, 23:00), matching the API's default toggle end. */
export const SHIFT_BLOCKS: readonly ShiftBlock[] = [
  { key: 'day', label: '7 AM–5 PM', startHour: 7, endHour: 17 },
  { key: 'evening', label: '5 PM–11 PM', startHour: 17, endHour: 23 },
  { key: 'overnight', label: '11 PM–7 AM', startHour: 23, endHour: 7 },
];

/** A shift on `day` from `startHour` to `endHour`; an end at or before the start is the next day. */
export function shiftRange(day: Date, startHour: number, endHour: number) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + (endHour <= startHour ? 1 : 0), endHour);
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

/** The preset block a shift matches by its local hours, or null for a custom one. */
export function matchBlock(shift: Pick<ShiftLike, 'starts_at' | 'ends_at'>): ShiftBlock | null {
  const start = new Date(shift.starts_at);
  const end = new Date(shift.ends_at);
  if (start.getMinutes() || end.getMinutes()) return null;
  return (
    SHIFT_BLOCKS.find((b) => {
      const r = shiftRange(start, b.startHour, b.endHour);
      return r.starts_at === start.toISOString() && r.ends_at === end.toISOString();
    }) ?? null
  );
}

/** "11 PM – 7 AM (next day)" */
export function rangeLabel(startsAt: string, endsAt: string) {
  const nextDay = !sameDay(new Date(startsAt), new Date(endsAt));
  return `${clock(startsAt)} – ${clock(endsAt)}${nextDay ? ' (next day)' : ''}`;
}
