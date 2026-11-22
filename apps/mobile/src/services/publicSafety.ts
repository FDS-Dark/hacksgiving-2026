import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { IncidentPoint } from '@/api/types';

export const INCIDENT_CATEGORIES = [
  { id: 'homicide', label: 'Homicide', layer: 0, color: '#A61B1B' },
  { id: 'arson', label: 'Arson', layer: 1, color: '#B93815' },
  { id: 'sex-offense', label: 'Sex offense', layer: 2, color: '#7A4EAB' },
  { id: 'criminal-damage', label: 'Property damage', layer: 3, color: '#7F5D3B' },
  { id: 'robbery', label: 'Robbery', layer: 4, color: '#D76B18' },
  { id: 'burglary', label: 'Burglary', layer: 5, color: '#B77A18' },
  { id: 'theft', label: 'Theft', layer: 6, color: '#2877A8' },
  { id: 'vehicle-theft', label: 'Vehicle theft', layer: 7, color: '#176B87' },
  { id: 'vehicle-entry', label: 'Vehicle break-in', layer: 8, color: '#4B7892' },
  { id: 'assault', label: 'Assault', layer: 9, color: '#D6A21F' },
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]['id'];

export type SafetyPoint = {
  id: string;
  category: IncidentCategory | 'community-report';
  latitude: number;
  longitude: number;
  ageInDays?: number;
  reportedAt?: string;
  weaponUsed?: string;
  reportedCategory?: IncidentCategory;
  note?: string;
  source: 'Milwaukee Police Department' | 'Community report';
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORY_IDS = new Set<string>(INCIDENT_CATEGORIES.map((c) => c.id));

/** Map points from the API's reviewed incidents (NIBRS, at about 1 km):
 *  those in one of the map's categories. */
export function toSafetyPoints(incidents: IncidentPoint[], now = Date.now()): SafetyPoint[] {
  return incidents.flatMap((incident, index) => {
    const category = incident.category;
    if (!category || !CATEGORY_IDS.has(category)) return [];
    const at = new Date(incident.incident_at).getTime();
    return [{
      id: `${category}-${index}-${incident.latitude}-${incident.longitude}`,
      category: category as IncidentCategory,
      latitude: incident.latitude,
      longitude: incident.longitude,
      ageInDays: Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY_MS)) : undefined,
      reportedAt: Number.isFinite(at) ? new Date(at).toISOString() : undefined,
      weaponUsed: incident.weapons.filter((w) => w && w !== 'NONE' && w !== 'UNKNOWN').join(', ') || undefined,
      source: 'Milwaukee Police Department' as const,
    }];
  });
}

export type SafetyWindowDays = 7 | 30 | 365;

async function fetchSafetyPoints(days: SafetyWindowDays) {
  return toSafetyPoints(await request<IncidentPoint[]>(`/public-data/incidents?days=${days}&limit=10000`, { auth: false }));
}

/** MPD-reviewed incidents for the selected window (updated daily; they can
 *  lag several weeks). When the API can't be reached the map shows nothing,
 *  never made-up points. */
export function usePublicSafetyPoints(days: SafetyWindowDays = 30) {
  const query = useQuery({
    queryKey: ['public-safety-points', days],
    queryFn: () => fetchSafetyPoints(days),
    staleTime: 1000 * 60 * 15,
    refetchInterval: 1000 * 60 * 15,
    refetchOnMount: 'always',
    retry: 1,
  });

  return {
    ...query,
    points: query.data ?? [],
    isUnavailable: !!query.error,
  };
}
