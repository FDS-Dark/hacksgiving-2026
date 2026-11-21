/**
 * Milwaukee Police Department calls for service, from our API
 * (GET /v1/safety/calls). The API ingests the city's page every five minutes,
 * geocodes each call to its block, and summarizes the window; the app no
 * longer scrapes the city page itself.
 */
import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { MpdCall, MpdCalls, MpdCallSummary } from '@/api/types';

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

export const CALL_WINDOWS = [
  { value: '2', label: '2 hours' },
  { value: '6', label: '6 hours' },
  { value: '24', label: '24 hours' },
] as const;
export type CallWindow = (typeof CALL_WINDOWS)[number]['value'];

export function callCategory(id: string) {
  return CALL_CATEGORIES.find((item) => item.id === id) ?? CALL_CATEGORIES[CALL_CATEGORIES.length - 1];
}

export type RecentCall = {
  id: string;
  /** ISO dispatch time. */
  dispatchedAt: string;
  /** Short local time for display, e.g. "2:30 PM". */
  occurredAt: string;
  block: string;
  latitude?: number;
  longitude?: number;
  district: string;
  nature: string;
  status: string;
  category: CallCategory;
};

export type CallFeed = {
  calls: RecentCall[];
  summary: MpdCallSummary;
  lastUpdatedAt: string | null;
  stale: boolean;
};

/** Calls the Alerts tab surfaces: crime and danger, not routine traffic stops or admin calls. */
const ALERT_CATEGORIES = new Set<string>(['weapons', 'violent', 'property']);
const ALERT_TERMS = ['reckless vehicle', 'drug dealing', 'arson'];

export function isAlertCall(call: Pick<RecentCall, 'category' | 'nature'>) {
  const nature = call.nature.toLowerCase();
  return ALERT_CATEGORIES.has(call.category) || ALERT_TERMS.some((term) => nature.includes(term));
}

export function toRecentCall(call: MpdCall): RecentCall {
  const when = new Date(call.dispatched_at);
  return {
    id: call.call_number,
    dispatchedAt: call.dispatched_at,
    occurredAt: Number.isNaN(when.getTime())
      ? call.dispatched_at
      : when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    block: call.block,
    latitude: call.latitude ?? undefined,
    longitude: call.longitude ?? undefined,
    district: call.district,
    nature: call.nature,
    status: call.status,
    category: callCategory(call.category).id,
  };
}

export function toCallFeed(data: MpdCalls): CallFeed {
  return {
    calls: data.calls.map(toRecentCall),
    summary: data.summary,
    lastUpdatedAt: data.last_updated_at ?? null,
    stale: data.stale,
  };
}

export const callsApi = {
  list: (hours: number) => request<MpdCalls>(`/safety/calls?hours=${hours}`),
};

export const callKeys = {
  all: ['mpd-calls'] as const,
  window: (hours: number) => ['mpd-calls', hours] as const,
};

/** Every call in the window, with its summary. Polls our API (not the city)
 *  every two minutes, so a new ingest shows up within a couple of minutes. */
export function useCallFeed(hours: number) {
  return useQuery({
    queryKey: callKeys.window(hours),
    queryFn: () => callsApi.list(hours),
    select: toCallFeed,
    refetchInterval: 1000 * 60 * 2,
    staleTime: 1000 * 60,
    retry: 1,
  });
}

/** The Alerts tab's live feed: safety-related calls from the last two hours. */
export function useRecentCalls() {
  return useQuery({
    queryKey: callKeys.window(2),
    queryFn: () => callsApi.list(2),
    select: (data: MpdCalls) => data.calls.map(toRecentCall).filter(isAlertCall),
    refetchInterval: 1000 * 60 * 2,
    staleTime: 1000 * 60,
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
