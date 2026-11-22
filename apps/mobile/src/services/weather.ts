/**
 * Weather alerts (GET /public-data/weather-alerts): National Weather Service
 * alerts in effect for Milwaukee County, kept current by the data loader
 * (every 5 minutes). The API already drops expired ones.
 */
import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { WeatherAlert } from '@/api/types';

/** NWS severities, most severe first. Anything else sorts last. */
const SEVERITY = ['Extreme', 'Severe', 'Moderate', 'Minor'];

function rank(alert: WeatherAlert) {
  const i = SEVERITY.indexOf(alert.severity ?? '');
  return i === -1 ? SEVERITY.length : i;
}

/** In effect now: started (or no start given) and not yet expired. */
export function inEffect(alert: WeatherAlert, now = Date.now()) {
  const starts = alert.effective_at ? new Date(alert.effective_at).getTime() : -Infinity;
  const ends = alert.expires_at ? new Date(alert.expires_at).getTime() : Infinity;
  return starts <= now && now < ends;
}

/** Alerts in effect, most severe first, then the newest. */
export function activeAlerts(alerts: WeatherAlert[], now = Date.now()): WeatherAlert[] {
  return alerts
    .filter((a) => inEffect(a, now))
    .sort((a, b) => rank(a) - rank(b) || (b.effective_at ?? '').localeCompare(a.effective_at ?? ''));
}

/** Cold or heat: someone outside needs a warm or cool place, so Home points to shelter. */
export function needsShelter(alert: WeatherAlert) {
  return /cold|chill|freez|frost|winter|blizzard|snow|ice|heat/i.test(alert.event);
}

export const weatherKeys = {
  all: ['weather-alerts'] as const,
};

export function useWeatherAlerts() {
  const query = useQuery({
    queryKey: weatherKeys.all,
    queryFn: () => request<WeatherAlert[]>('/public-data/weather-alerts', { auth: false }),
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
    retry: 1,
  });
  return { ...query, active: activeAlerts(query.data ?? []) };
}
