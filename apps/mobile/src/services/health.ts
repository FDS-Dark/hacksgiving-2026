import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';

export const healthKeys = { check: ['health'] as const };

export const healthApi = {
  check: () => request<{ status: string }>('/health', { auth: false }),
};

/** Whether the API answers; for the "Synced / Offline" pill. */
export function useApiHealth() {
  return useQuery({ queryKey: healthKeys.check, queryFn: healthApi.check, retry: false });
}
