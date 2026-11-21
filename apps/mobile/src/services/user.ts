import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { AppUser, ClaimHandoff, UpdateMe, VoiceFollowUp } from '@/api/types';
import { keys } from '@/services/queryClient';

export const userApi = {
  me: () => request<AppUser>('/me'),
  updateMe: (changes: UpdateMe) => request<AppUser>('/me', { method: 'PATCH', body: changes }),
  followUps: () => request<VoiceFollowUp[]>('/voice/follow-ups'),
  claimHandoff: (body: ClaimHandoff) =>
    request<VoiceFollowUp>('/voice/handoffs/claim', { method: 'POST', body }),
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: userApi.me });
}

export function useVoiceFollowUps() {
  return useQuery({
    queryKey: keys.voiceFollowUps,
    queryFn: userApi.followUps,
    refetchInterval: 30_000,
  });
}

export function useClaimVoiceHandoff() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: userApi.claimHandoff,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.voiceFollowUps }),
  });
}
