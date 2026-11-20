import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import { keys } from '@/services/queryClient';

export const healthApi = {
  check: () => request<{ status: string }>('/health', { auth: false }),
};

/** Whether the API answers; for the "Synced / Offline" pill. */
export function useApiHealth() {
  return useQuery({ queryKey: keys.health, queryFn: healthApi.check, retry: false });
}
