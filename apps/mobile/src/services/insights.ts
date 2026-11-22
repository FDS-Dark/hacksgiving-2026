/**
 * Insights with filters (/v1/insights): cases opened in a period, in one
 * police district or all, by need, and the patterns spotted among them.
 * Staff only. The all-time dashboard numbers are `useInsights` in cases.ts.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { Insights } from '@/api/types';

export const INSIGHT_PERIODS = ['7', '30', '90'] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

export const insightsApi = {
  get: (days: number, district: string | null) =>
    request<Insights>(`/insights${queryString({ days, district: district ?? undefined })}`),
};

export const insightsKeys = {
  all: ['insights'] as const,
  get: (days: number, district: string | null) => ['insights', days, district] as const,
};

/** Keeps the last answer on screen while a new filter loads. */
export function useFilteredInsights(days: number, district: string | null) {
  return useQuery({
    queryKey: insightsKeys.get(days, district),
    queryFn: () => insightsApi.get(days, district),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}
