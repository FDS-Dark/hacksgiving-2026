/**
 * Community alerts (/v1/me/community-alerts, Figma R5): a push when the
 * National Weather Service issues a serious alert for Milwaukee. Off until
 * the resident turns it on.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { CommunityAlerts } from '@/api/types';

export const communityApi = {
  get: () => request<CommunityAlerts>('/me/community-alerts'),
  set: (subscribed: boolean) => request<CommunityAlerts>('/me/community-alerts', { method: 'PUT', body: { subscribed } }),
};

export const communityKeys = {
  alerts: ['community-alerts'] as const,
};

export function useCommunityAlerts(enabled = true) {
  return useQuery({ queryKey: communityKeys.alerts, queryFn: communityApi.get, enabled });
}

export function useSetCommunityAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: communityApi.set,
    onSuccess: (data) => qc.setQueryData(communityKeys.alerts, data),
  });
}
