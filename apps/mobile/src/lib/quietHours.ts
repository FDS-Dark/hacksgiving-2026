/**
 * Quiet hours as the API stores them: "HH:MM" local clock times, a window
 * that may cross midnight (21:00 to 07:00). Pure helpers for the settings
 * screen.
 */

export const QUIET_PRESETS = [
  { start: '21:00', end: '07:00' },
  { start: '22:00', end: '06:00' },
  { start: '23:00', end: '08:00' },
] as const;

export const DEFAULT_QUIET = QUIET_PRESETS[0];

/** "HH:MM" (or "HH:MM:SS") → minutes after midnight. */
export function toMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) % (24 * 60);
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Moves a clock time by `delta` minutes, wrapping around midnight. */
export function shift(clock: string, delta: number): string {
  return fromMinutes(toMinutes(clock) + delta);
}

/** "21:00" → "9:00 PM". */
export function label(clock: string): string {
  const minutes = toMinutes(clock);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** How long the window is, e.g. "10 hours" (a window may cross midnight). */
export function length(start: string, end: string): string {
  const minutes = (toMinutes(end) - toMinutes(start) + 1440) % 1440;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours.toFixed(1)} hours`;
}

/** Same clock time (the API may send seconds). */
export function sameTime(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && toMinutes(a) === toMinutes(b);
}
