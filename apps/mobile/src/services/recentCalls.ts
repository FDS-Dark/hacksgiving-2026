/**
 * Delayed MPD 911 dispatch calls, from our API (GET /public-data/calls). The
 * data loader polls the city's page every 5 minutes (it allows 10 requests
 * per 30 minutes per address); addresses never leave the server, and
 * sensitive call types are never listed (docs/data-loader.md).
 *
 * The app groups the calls (weapons, violence, property, ...) and counts them
 * for the safety map's summary itself.
 */
import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { DispatchCall } from '@/api/types';

/** Alerts tab: the crime-related calls. */
const ALERT_TERMS = [
  'shooting',
  'shots fired',
  'subject with a weapon',
  'stabbing',
  'robbery',
  'battery',
  'fight',
  'assault',
  'dead on entry',
  'sexual assault',
  'burglary',
  'entry-building or structure',
  'theft',
  'stolen vehicle',
  'vehicle theft',
  'arson',
  'criminal damage',
  'drug dealing',
  'reckless vehicle',
];

/** Map and chip colors, one fixed slot per category (validated categorical
 *  palette; identity is also carried by text labels, never color alone). */
export const CALL_CATEGORIES = [
  { id: 'weapons', label: 'Weapons & shots', color: '#EB6834' },
  { id: 'violent', label: 'Violence', color: '#E87BA4' },
  { id: 'property', label: 'Property', color: '#2A78D6' },
  { id: 'traffic', label: 'Traffic', color: '#1BAF7A' },
  { id: 'disorder', label: 'Disorder', color: '#EDA100' },
  { id: 'assist', label: 'Assistance', color: '#008300' },
  { id: 'other', label: 'Other / 911', color: '#8C979B' },
] as const;

export type CallCategory = (typeof CALL_CATEGORIES)[number]['id'];

// First match wins, so the specific terms come before the general ones.
const CATEGORY_TERMS: [CallCategory, string[]][] = [
  ['weapons', ['weapon', 'shots fired', 'shotspotter', 'shot spotter', 'shooting', 'stabbing', 'armed']],
  ['violent', ['battery', 'fight', 'assault', 'robbery', 'homicide', 'dead on', 'kidnap', 'threat', 'carjack', 'hold up', 'abuse']],
  ['property', ['theft', 'burglary', 'entry', 'stolen', 'damage', 'vandal', 'arson', 'fraud', 'shoplift', 'trespass', 'retail']],
  ['traffic', ['traffic', 'reckless', 'accident', 'crash', 'hit and run', 'driving', 'vehicle', 'pursuit', 'parking', 'motor', 'speed']],
  ['disorder', ['noise', 'trouble', 'suspicious', 'disturb', 'nuisance', 'drug', 'loud', 'intoxicated', 'gambling', 'fireworks']],
  ['assist', ['resource', 'meet', 'follow up', 'pickup', 'return station', 'community', 'assignment', 'checking', 'investigation', 'wanted', 'alarm', 'escort', 'transport', 'warrant', 'assist']],
];

export function categoryOf(nature: string): CallCategory {
  const lower = nature.toLowerCase();
  return CATEGORY_TERMS.find(([, terms]) => terms.some((term) => lower.includes(term)))?.[0] ?? 'other';
}

export function callCategory(id: string) {
  return CALL_CATEGORIES.find((item) => item.id === id) ?? CALL_CATEGORIES[CALL_CATEGORIES.length - 1];
}

export const CALL_WINDOWS = [
  { value: '2', label: '2 hours' },
  { value: '6', label: '6 hours' },
  { value: '24', label: '24 hours' },
] as const;
export type CallWindow = (typeof CALL_WINDOWS)[number]['value'];

/** How often the app asks our API for calls. Our own server, so the city's
 *  rate limit doesn't apply; React Query pauses polling in the background. */
export const CALL_REFRESH_MS = 30_000;

/** MPD's own publishing delay, shown wherever calls appear. */
export const CALL_DELAY_NOTE = 'MPD publishes calls 30–90 min after dispatch';

export type RecentCall = {
  id: string;
  /** ISO dispatch time. */
  dispatchedAt: string;
  /** Short local date and time for display. */
  occurredAt: string;
  latitude?: number;
  longitude?: number;
  district: string;
  nature: string;
  status: string;
  category: CallCategory;
};

export type CountItem = { label: string; count: number };

export type CallSummaryData = {
  hours: number;
  total: number;
  /** Calls with coordinates (the rest can't be placed on the map). */
  mapped: number;
  by_category: CountItem[];
  /** The most common call types, most first (top 10). */
  by_nature: CountItem[];
  /** Districts 1-7 in order, then any others. */
  by_district: CountItem[];
  /** Calls per local clock hour, oldest first, labelled like '2 PM'. */
  by_hour: CountItem[];
};

export type CallFeed = {
  calls: RecentCall[];
  summary: CallSummaryData;
  /** When the app last read our API. */
  lastUpdatedAt: string | null;
  stale: boolean;
};

function shownAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function toRecentCall(call: DispatchCall): RecentCall {
  return {
    id: call.call_number,
    dispatchedAt: call.occurred_at,
    occurredAt: shownAt(call.occurred_at),
    district: call.district ?? '',
    nature: call.category,
    status: call.status ?? '',
    category: categoryOf(call.category),
    ...(call.latitude != null && call.longitude != null ? { latitude: call.latitude, longitude: call.longitude } : {}),
  };
}

/** The crime-related calls, in the shape the map and alerts use. */
export function toRecentCalls(calls: DispatchCall[]): RecentCall[] {
  return calls
    .filter((call) => ALERT_TERMS.some((term) => call.category.toLowerCase().includes(term)))
    .map(toRecentCall);
}

function hourLabel(date: Date) {
  const hour = date.getHours() % 12 || 12;
  return `${hour} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
}

function counts<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return map;
}

/** Totals and breakdowns for the summary under the map. */
export function summarize(calls: RecentCall[], hours: number, now = new Date()): CallSummaryData {
  const byCategory = counts(calls, (c) => c.category);
  const byNature = counts(calls, (c) => c.nature);
  const byDistrict = counts(calls, (c) => c.district || 'Unknown');
  const districts = ['1', '2', '3', '4', '5', '6', '7'];

  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  const starts = Array.from({ length: hours }, (_, i) => new Date(end.getTime() - (hours - 1 - i) * 3_600_000));
  const byHour = counts(calls, (c) => {
    const at = new Date(c.dispatchedAt);
    at.setMinutes(0, 0, 0);
    return String(at.getTime());
  });

  return {
    hours,
    total: calls.length,
    mapped: calls.filter((c) => c.latitude !== undefined).length,
    by_category: CALL_CATEGORIES.filter((c) => byCategory.get(c.id)).map((c) => ({ label: c.id, count: byCategory.get(c.id) ?? 0 })),
    by_nature: [...byNature.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count })),
    by_district: [
      ...districts.map((d) => ({ label: d, count: byDistrict.get(d) ?? 0 })),
      ...[...byDistrict.entries()].filter(([d]) => !districts.includes(d)).sort().map(([label, count]) => ({ label, count })),
    ],
    by_hour: starts.map((start) => ({ label: hourLabel(start), count: byHour.get(String(start.getTime())) ?? 0 })),
  };
}

export function toCallFeed(calls: DispatchCall[], hours: number, fetchedAt: number, now = new Date()): CallFeed {
  const recent = calls.map(toRecentCall);
  return {
    calls: recent,
    summary: summarize(recent, hours, now),
    lastUpdatedAt: new Date(fetchedAt).toISOString(),
    stale: false,
  };
}

export const callsApi = {
  list: (hours: number, limit = 1000) =>
    request<DispatchCall[]>(`/public-data/calls?source=mpd_calls&hours=${hours}&limit=${limit}`, { auth: false }),
};

export const callKeys = {
  all: ['mpd-calls'] as const,
  window: (hours: number) => ['mpd-calls', hours] as const,
};

/** Every call in the window, with its summary. */
export function useCallFeed(hours: number) {
  return useQuery({
    queryKey: callKeys.window(hours),
    queryFn: async () => ({ calls: await callsApi.list(hours), fetchedAt: Date.now() }),
    select: (data) => toCallFeed(data.calls, hours, data.fetchedAt),
    refetchInterval: CALL_REFRESH_MS,
    staleTime: CALL_REFRESH_MS / 2,
    retry: 1,
  });
}

/** The Alerts tab's live feed: crime-related calls from the last six hours. */
export function useRecentCalls() {
  return useQuery({
    queryKey: ['mpd-recent-calls'],
    queryFn: async () => toRecentCalls(await callsApi.list(6, 500)),
    refetchInterval: CALL_REFRESH_MS,
    staleTime: CALL_REFRESH_MS / 2,
    refetchOnMount: 'always',
    retry: 1,
  });
}

export function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.asin(Math.sqrt(h));
}
