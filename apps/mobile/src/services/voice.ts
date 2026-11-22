/**
 * Voice (/v1/voice): phone calls with the ComForce assistant, connected to
 * an app account with a one-time handoff code.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type {
  ClaimHandoff,
  VoiceCallReview,
  VoiceCallReviewDetail,
  VoiceDashboard,
  VoiceFollowUp,
  VoiceReferralDetail,
  VoiceImpactSummary,
  RecordVoiceOutcome,
} from '@/api/types';

export const voiceApi = {
  followUps: () => request<VoiceFollowUp[]>('/voice/follow-ups'),
  claimHandoff: (body: ClaimHandoff) => request<VoiceFollowUp>('/voice/handoffs/claim', { method: 'POST', body }),
  referrals: () => request<VoiceReferralDetail[]>('/voice/referrals'),
  referral: (id: string) => request<VoiceReferralDetail>(`/voice/referrals/${id}`),
  staffCalls: () => request<VoiceCallReview[]>('/voice/staff/calls'),
  staffCall: (id: string) => request<VoiceCallReviewDetail>(`/voice/staff/calls/${id}`),
  impact: () => request<VoiceImpactSummary>('/voice/impact'),
  recordOutcome: (id: string, body: RecordVoiceOutcome) => request(`/voice/referrals/${id}/responder-outcome`, { method: 'POST', body }),
  dashboard: () => request<VoiceDashboard>('/voice/dashboard'),
};

export const voiceKeys = {
  all: ['voice'] as const,
  followUps: ['voice', 'follow-ups'] as const,
  referrals: ['voice', 'referrals'] as const,
  referral: (id: string) => ['voice', 'referrals', id] as const,
  staffCalls: ['voice', 'staff', 'calls'] as const,
  staffCall: (id: string) => ['voice', 'staff', 'calls', id] as const,
  impact: ['voice', 'impact'] as const,
  dashboard: ['voice', 'dashboard'] as const,
};

export function useVoiceFollowUps() {
  return useQuery({ queryKey: voiceKeys.followUps, queryFn: voiceApi.followUps, refetchInterval: 30_000 });
}

export function useClaimVoiceHandoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: voiceApi.claimHandoff,
    onSuccess: () => qc.invalidateQueries({ queryKey: voiceKeys.all }),
  });
}

export function useVoiceReferrals() {
  return useQuery({ queryKey: voiceKeys.referrals, queryFn: voiceApi.referrals, refetchInterval: 30_000 });
}

export function useVoiceReferral(id: string) {
  return useQuery({ queryKey: voiceKeys.referral(id), queryFn: () => voiceApi.referral(id), enabled: !!id });
}

export function useRecordVoiceOutcome(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordVoiceOutcome) => voiceApi.recordOutcome(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: voiceKeys.all }),
  });
}

export function useVoiceImpact() {
  return useQuery({ queryKey: voiceKeys.impact, queryFn: voiceApi.impact, refetchInterval: 30_000 });
}

export function useStaffVoiceCalls() {
  return useQuery({ queryKey: voiceKeys.staffCalls, queryFn: voiceApi.staffCalls, refetchInterval: 30_000 });
}

export function useStaffVoiceCall(id: string) {
  return useQuery({ queryKey: voiceKeys.staffCall(id), queryFn: () => voiceApi.staffCall(id), enabled: !!id });
}

/** Phone-agent calls in numbers (Insights): calls, 911 redirects, referrals. */
export function useVoiceDashboard() {
  return useQuery({ queryKey: voiceKeys.dashboard, queryFn: voiceApi.dashboard, refetchInterval: 60_000 });
}
