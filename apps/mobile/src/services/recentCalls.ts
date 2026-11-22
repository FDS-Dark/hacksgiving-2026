import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { DispatchCall } from '@/api/types';

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

export type RecentCall = {
  id: string;
  occurredAt: string;
  latitude?: number;
  longitude?: number;
  district: string;
  nature: string;
  status: string;
  source: 'mpd_calls' | 'mfd_calls';
};

export type DispatchSource = RecentCall['source'] | 'all';

// Delayed MPD dispatch calls come from the API: the loader polls the city's
// page every 5 minutes (it allows 10 requests per 30 minutes per address),
// and addresses never leave the server.

function shownAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The crime-related calls, in the shape the map and alerts use. */
export function toRecentCalls(calls: DispatchCall[]): RecentCall[] {
  return calls
    .filter((call) => call.source === 'mfd_calls' || ALERT_TERMS.some((term) => call.category.toLowerCase().includes(term)))
    .map((call) => ({
      id: call.call_number,
      occurredAt: shownAt(call.occurred_at),
      district: call.district ?? '',
      nature: call.category,
      status: call.status ?? '',
      source: call.source === 'mfd_calls' ? 'mfd_calls' as const : 'mpd_calls' as const,
      ...(call.latitude != null && call.longitude != null ? { latitude: call.latitude, longitude: call.longitude } : {}),
    }));
}

async function fetchRecentCalls(source: DispatchSource) {
  const sourceParam = source === 'all' ? '' : `source=${source}&`;
  return toRecentCalls(await request<DispatchCall[]>(`/public-data/calls?${sourceParam}hours=6&limit=500`, { auth: false }));
}

export function useRecentCalls(source: DispatchSource = 'mpd_calls') {
  return useQuery({
    queryKey: ['recent-calls', source],
    queryFn: () => fetchRecentCalls(source),
    refetchInterval: 1000 * 60 * 5,
    staleTime: 1000 * 60 * 4,
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
