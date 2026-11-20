import { useQuery } from '@tanstack/react-query';

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

type GeoJsonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { DAYSPASSED?: number; REPORTEDDATETIME?: number | string; WEAPONUSED?: string };
};

type GeoJsonResponse = { features?: GeoJsonFeature[] };

const SERVICE_ROOT = 'https://milwaukeemaps.milwaukee.gov/arcgis/rest/services/MPD/MPD_Monthly/MapServer';

const FALLBACK_POINTS: SafetyPoint[] = [
  { id: 'fallback-h-1', category: 'homicide', latitude: 43.07, longitude: -87.95, ageInDays: 18, source: 'Milwaukee Police Department' },
  { id: 'fallback-s-1', category: 'sex-offense', latitude: 43.03, longitude: -87.93, ageInDays: 31, source: 'Milwaukee Police Department' },
  { id: 'fallback-r-1', category: 'robbery', latitude: 43.05, longitude: -87.91, ageInDays: 9, source: 'Milwaukee Police Department' },
  { id: 'fallback-a-1', category: 'assault', latitude: 43.1, longitude: -87.97, ageInDays: 4, source: 'Milwaukee Police Department' },
  { id: 'fallback-a-2', category: 'assault', latitude: 43.0, longitude: -87.9, ageInDays: 24, source: 'Milwaukee Police Department' },
];

async function fetchCategory(category: (typeof INCIDENT_CATEGORIES)[number]): Promise<SafetyPoint[]> {
  const params = new URLSearchParams({
    where: 'DAYSPASSED <= 30',
    outFields: 'DAYSPASSED,REPORTEDDATETIME,WEAPONUSED',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '2',
    resultRecordCount: '2000',
    f: 'geojson',
  });
  const response = await fetch(`${SERVICE_ROOT}/${category.layer}/query?${params}`);
  if (!response.ok) throw new Error(`MPD data request failed (${response.status})`);

  const data = (await response.json()) as GeoJsonResponse;
  return (data.features ?? []).flatMap((feature, index) => {
    const coordinates = feature.geometry?.coordinates;
    if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) return [];
    const reported = feature.properties?.REPORTEDDATETIME;
    const reportedDate = reported === undefined ? null : new Date(reported);
    return [{
      id: `${category.id}-${index}-${coordinates.join('-')}`,
      category: category.id,
      longitude: coordinates[0],
      latitude: coordinates[1],
      ageInDays: feature.properties?.DAYSPASSED,
      reportedAt: reportedDate && !Number.isNaN(reportedDate.getTime()) ? reportedDate.toISOString() : undefined,
      weaponUsed: feature.properties?.WEAPONUSED?.trim() || undefined,
      source: 'Milwaukee Police Department' as const,
    }];
  });
}

async function fetchSafetyPoints() {
  const results = await Promise.all(INCIDENT_CATEGORIES.map(fetchCategory));
  return results.flat();
}

export function usePublicSafetyPoints() {
  const query = useQuery({
    queryKey: ['public-safety-points'],
    queryFn: fetchSafetyPoints,
    staleTime: 1000 * 60 * 15,
    refetchInterval: 1000 * 60 * 15,
    refetchOnMount: 'always',
    retry: 1,
  });

  return {
    ...query,
    points: query.data?.length ? query.data : FALLBACK_POINTS,
    isUsingFallback: !!query.error || (!!query.data && query.data.length === 0),
  };
}
