import { useQuery } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { CrimeTrendPoint, SourceHealth, TransitNearby } from '@/api/types';

export function useSourceHealth() {
  return useQuery({
    queryKey: ['public-data-sources'],
    queryFn: () => request<SourceHealth[]>('/public-data/sources', { auth: false }),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useCrimeTrends(offense = 'violent-crime') {
  return useQuery({
    queryKey: ['crime-trends', offense],
    queryFn: () => request<CrimeTrendPoint[]>(`/public-data/crime-trends${queryString({ offense })}`, { auth: false }),
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}

export function useTransitNearby(latitude?: number | null, longitude?: number | null) {
  const enabled = latitude != null && longitude != null;
  return useQuery({
    queryKey: ['transit-nearby', latitude, longitude],
    queryFn: () => request<TransitNearby>(`/public-data/transit/nearby${queryString({ latitude, longitude, radius_m: 800, limit: 3 })}`, { auth: false }),
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: enabled ? 60 * 1000 : false,
    retry: 1,
  });
}

export type YearComparison = {
  current: number;
  previous: number;
  percentChange: number | null;
  latestMonth: string;
};

/** Compare the latest 12 complete points with the preceding 12 for MPD's
 * actual incident series. Returns null when the feed cannot support a fair
 * comparison instead of presenting a misleading partial trend. */
export function yearOverYear(points: CrimeTrendPoint[]): YearComparison | null {
  const values = points
    .filter((point) => point.measure === 'actual' && point.series.toLowerCase().includes('milwaukee') && point.value != null)
    .sort((a, b) => a.month.localeCompare(b.month));
  if (values.length < 24) return null;
  const latest = values.slice(-24);
  const previous = latest.slice(0, 12).reduce((sum, point) => sum + (point.value ?? 0), 0);
  const current = latest.slice(12).reduce((sum, point) => sum + (point.value ?? 0), 0);
  return {
    current,
    previous,
    percentChange: previous ? ((current - previous) / previous) * 100 : null,
    latestMonth: latest[23].month,
  };
}

export function sourceLabel(source: string) {
  return ({
    mke_nibrs: 'MPD reviewed incidents',
    mke_boundaries: 'Milwaukee map boundaries',
    mpd_calls: 'MPD dispatch calls',
    mfd_calls: 'MFD fire & EMS calls',
    mcts_gtfs: 'MCTS routes & stops',
    mcts_alerts: 'MCTS service alerts',
    nws_alerts: 'National Weather Service',
    fbi_cde: 'FBI crime trends',
    cdc_places: 'CDC community indicators',
  } as Record<string, string>)[source] ?? source.replaceAll('_', ' ');
}
