import { useQuery } from '@tanstack/react-query';

const CALLS_URL = 'https://itmdapps.milwaukee.gov/MPDCallData/';

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
};

function textOf(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function dmsToDecimal(value: string) {
  const [degreesText, minutesText, secondsText] = value.split(':');
  const degrees = Number(degreesText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  const sign = degrees < 0 ? -1 : 1;
  return sign * (Math.abs(degrees) + minutes / 60 + seconds / 3600);
}

function coordinatesOf(location: string) {
  const match = location.match(/LL\(([-\d:.]+),([-\d:.]+)\)/i);
  if (!match) return null;
  const longitude = dmsToDecimal(match[1]);
  const latitude = dmsToDecimal(match[2]);
  if (latitude === null || longitude === null) return null;
  // Do not reproduce the precise call location. Roughly 110 m precision is
  // enough for an on-device proximity alert without exposing a residence.
  return {
    latitude: Math.round(latitude * 1000) / 1000,
    longitude: Math.round(longitude * 1000) / 1000,
  };
}

export function parseRecentCalls(html: string): RecentCall[] {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const calls = new Map<string, RecentCall>();

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => textOf(match[1]));
    if (cells.length < 6) continue;
    const [id, occurredAt, location, district, nature, status] = cells;
    if (!/^P\d+$/i.test(id) || !ALERT_TERMS.some((term) => nature.toLowerCase().includes(term))) continue;
    calls.set(id, { id, occurredAt, district, nature, status, ...coordinatesOf(location) });
  }

  return [...calls.values()];
}

async function fetchRecentCalls() {
  const response = await fetch(CALLS_URL, { headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Calls-for-service request failed (${response.status})`);
  return parseRecentCalls(await response.text());
}

export function useRecentCalls() {
  return useQuery({
    queryKey: ['mpd-recent-calls'],
    queryFn: fetchRecentCalls,
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
