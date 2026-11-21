/**
 * Voice (/v1/voice): phone calls with the ComForce assistant, connected to
 * an app account with a one-time handoff code.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { ClaimHandoff, VoiceFollowUp } from '@/api/types';

export const voiceApi = {
  followUps: () => request<VoiceFollowUp[]>('/voice/follow-ups'),
  claimHandoff: (body: ClaimHandoff) => request<VoiceFollowUp>('/voice/handoffs/claim', { method: 'POST', body }),
};

export const voiceKeys = {
  all: ['voice'] as const,
  followUps: ['voice', 'follow-ups'] as const,
};

export function useVoiceFollowUps() {
  return useQuery({ queryKey: voiceKeys.followUps, queryFn: voiceApi.followUps, refetchInterval: 30_000 });
}

export function useClaimVoiceHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: voiceApi.claimHandoff,
    onSuccess: () => qc.invalidateQueries({ queryKey: voiceKeys.followUps }),
  });
}
