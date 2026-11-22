/**
 * Nearby's short list (Figma R3): which places are open today, how far
 * they are, and the order to show them in.
 *
 * A place's hours are free text from the directory ("Monday-Friday ·
 * 11:00AM - 12:00PM", "Tuesdays and Saturdays", "Call for hours"), so
 * "open today" only looks at the days named. It is "yes" when today is one
 * of them, "no" when other days are named and today isn't, and "unknown"
 * when the text names no days, only some weeks ("2nd & 4th Saturdays"), or
 * says to call. Times of day are not checked.
 */
import type { CaseCategory, Resource } from '@/api/types';
import { milesBetween } from '@/services/recentCalls';

export type OpenToday = 'yes' | 'no' | 'unknown';

/** What a resident calls each kind of place, in a word or two. */
export const PLACE_LABEL: Record<CaseCategory, string> = {
  homelessness: 'Shelter',
  meal_programs: 'Food',
  transportation: 'Rides',
  violence_prevention: 'Safety',
  incident_deescalation: 'Calming support',
  missing_persons: 'Missing person',
  burial_assistance: 'Burial help',
  bridge_to_employment: 'Jobs',
  other: 'Other help',
};

/** The categories offered first; the rest wait behind "More filters". */
export const FIRST_CATEGORIES: CaseCategory[] = ['homelessness', 'meal_programs'];

const DAY_WORDS: [RegExp, number][] = [
  [/^sun/, 0],
  [/^mon/, 1],
  [/^tue/, 2],
  [/^wed/, 3],
  [/^thu/, 4],
  [/^fri/, 5],
  [/^sat/, 6],
];

const DAY = '(sun(?:day)?s?|mon(?:day)?s?|tue(?:s|sday)?s?|wed(?:s|nesday)?s?|thu(?:r|rs|rsday)?s?|fri(?:day)?s?|sat(?:urday)?s?)';
const RANGE = new RegExp(`\\b${DAY}\\s*(?:-|–|—|to|through|thru)\\s*${DAY}\\b`, 'g');
const SINGLE = new RegExp(`\\b${DAY}\\b`, 'g');
/** "1st Saturday", "first 4 Tuesdays", "2nd & 4th Saturdays": only some weeks. */
const ORDINAL_BEFORE = /\b(?:\d(?:st|nd|rd|th)|first|second|third|fourth|last)\b[^.;·]{0,8}$/;

function dayNumber(word: string): number {
  return DAY_WORDS.find(([pattern]) => pattern.test(word))?.[1] ?? -1;
}

/** The days a schedule names: every week, and only some weeks. */
export function scheduledDays(hours: string): { weekly: Set<number>; someWeeks: Set<number> } {
  const text = hours.toLowerCase();
  const weekly = new Set<number>();
  const someWeeks = new Set<number>();
  if (/24\s*\/\s*7|24 hours|\bdaily\b|every day|7 days/.test(text)) {
    for (let d = 0; d < 7; d++) weekly.add(d);
    return { weekly, someWeeks };
  }
  const add = (day: number, before: string) => (ORDINAL_BEFORE.test(before) ? someWeeks : weekly).add(day);

  // Ranges first ("Monday-Friday", "Sunday to Thursday"), then blank them out.
  let rest = text.replace(RANGE, (match, from: string, to: string, offset: number) => {
    const start = dayNumber(from);
    const end = dayNumber(to);
    if (start >= 0 && end >= 0) {
      for (let d = start, n = 0; n < 7; d = (d + 1) % 7, n++) {
        add(d, text.slice(Math.max(0, offset - 12), offset));
        if (d === end) break;
      }
    }
    return ' '.repeat(match.length);
  });
  rest = rest.replace(SINGLE, (match, word: string, offset: number) => {
    const day = dayNumber(word);
    if (day >= 0) add(day, rest.slice(Math.max(0, offset - 12), offset));
    return match;
  });
  return { weekly, someWeeks };
}

export function openToday(hours: string | null | undefined, now: Date = new Date()): OpenToday {
  if (!hours?.trim()) return 'unknown';
  const { weekly, someWeeks } = scheduledDays(hours);
  const today = now.getDay();
  if (weekly.has(today)) return 'yes';
  if (someWeeks.has(today)) return 'unknown';
  return weekly.size || someWeeks.size ? 'no' : 'unknown';
}

export const OPEN_LABEL: Record<OpenToday, string> = {
  yes: 'Open today',
  no: 'Closed today',
  unknown: 'Call to check hours',
};

export interface RankedPlace {
  place: Resource;
  open: OpenToday;
  /** Miles from the person, when we know both places. */
  miles: number | null;
}

const OPEN_ORDER: Record<OpenToday, number> = { yes: 0, unknown: 1, no: 2 };

/**
 * Every place, best first. Sample listings always come after real ones.
 * With the person's location, the closest come first (places without a
 * location after them); open today breaks ties. Without it, open today
 * comes first, then by name.
 */
export function rankPlaces(
  places: Resource[],
  { from, now = new Date() }: { from?: { latitude: number; longitude: number } | null; now?: Date } = {},
): RankedPlace[] {
  const ranked = places.map((place) => ({
    place,
    open: openToday(place.hours, now),
    miles:
      from && place.latitude != null && place.longitude != null
        ? milesBetween(from, { latitude: place.latitude, longitude: place.longitude })
        : null,
  }));
  return ranked.sort((a, b) => {
    if (a.place.is_sample !== b.place.is_sample) return a.place.is_sample ? 1 : -1;
    if (from) {
      if ((a.miles === null) !== (b.miles === null)) return a.miles === null ? 1 : -1;
      if (a.miles !== null && b.miles !== null && a.miles !== b.miles) return a.miles - b.miles;
    }
    if (a.open !== b.open) return OPEN_ORDER[a.open] - OPEN_ORDER[b.open];
    return a.place.name.localeCompare(b.place.name);
  });
}

export interface PlaceFilters {
  category?: CaseCategory | null;
  query?: string;
  openTodayOnly?: boolean;
}

export function filterPlaces(ranked: RankedPlace[], { category, query, openTodayOnly }: PlaceFilters): RankedPlace[] {
  const q = query?.trim().toLowerCase() ?? '';
  return ranked.filter(
    ({ place: r, open }) =>
      (!category || r.category === category) &&
      (!openTodayOnly || open === 'yes') &&
      (!q || [r.name, r.description, r.neighborhood, r.address].some((text) => text?.toLowerCase().includes(q))),
  );
}

/** "1.2 mi", or "0.1 mi" for anything closer. */
export function milesLabel(miles: number): string {
  return `${Math.max(0.1, miles).toFixed(1)} mi`;
}

/** "12 places", "1 place open today". */
export function countLabel(count: number, openTodayOnly: boolean): string {
  return `${count} ${count === 1 ? 'place' : 'places'}${openTodayOnly ? ' open today' : ''}`;
}
