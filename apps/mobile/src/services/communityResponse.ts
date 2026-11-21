import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import { keys } from '@/services/queryClient';

export type ReferralStatus = 'new' | 'connecting' | 'connected' | 'follow-up';
export type ReferralUrgency = 'routine' | 'priority';

export type CommunityReferral = {
  id: string;
  receivedAt: string;
  category: string;
  generalArea: string;
  urgency: ReferralUrgency;
  status: ReferralStatus;
  summary: string;
  language: string;
  destination: string;
};

export type ResponseRoute = {
  id: string;
  label: string;
  destination: string;
  availability: string;
  status: 'ready' | 'limited';
};

export type ImpactCategory = {
  label: string;
  referrals: number;
};

export type CommunityResponseDashboard = {
  generatedAt: string;
  stats: {
    callsToday: number;
    connectedRate: number;
    emergencyRedirects: number;
    openFollowUps: number;
  };
  activeReferrals: CommunityReferral[];
  routes: ResponseRoute[];
  weeklyImpact: ImpactCategory[];
};

const DEMO_DASHBOARD: CommunityResponseDashboard = {
  generatedAt: '2026-11-21T20:42:00-06:00',
  stats: {
    callsToday: 18,
    connectedRate: 83,
    emergencyRedirects: 2,
    openFollowUps: 4,
  },
  activeReferrals: [
    {
      id: 'demo-ref-1042',
      receivedAt: '2026-11-21T20:38:00-06:00',
      category: 'Conflict mediation',
      generalArea: 'Near West Side',
      urgency: 'priority',
      status: 'connecting',
      summary: 'Caller requested help de-escalating a developing neighborhood conflict. No immediate danger, weapon, injury, or crime in progress was reported.',
      language: 'English',
      destination: 'ComForce response team',
    },
    {
      id: 'demo-ref-1039',
      receivedAt: '2026-11-21T20:25:00-06:00',
      category: 'Housing support',
      generalArea: 'North Side',
      urgency: 'routine',
      status: 'new',
      summary: 'Caller is looking for short-term housing navigation and gave permission for a resource follow-up.',
      language: 'Spanish',
      destination: 'Milwaukee 211',
    },
    {
      id: 'demo-ref-1034',
      receivedAt: '2026-11-21T19:54:00-06:00',
      category: 'Mental health support',
      generalArea: 'South Side',
      urgency: 'priority',
      status: 'follow-up',
      summary: 'Caller accepted a connection to the county crisis line. Follow-up is due to confirm that the handoff was completed.',
      language: 'English',
      destination: 'Milwaukee Mobile Crisis',
    },
  ],
  routes: [
    { id: 'comforce', label: 'Violence interruption', destination: 'ComForce response team', availability: 'On call now', status: 'ready' },
    { id: 'mobile-crisis', label: 'Mental health crisis', destination: 'Milwaukee Mobile Crisis', availability: '24 hours', status: 'ready' },
    { id: '211', label: 'Basic needs and housing', destination: 'Milwaukee 211', availability: '24 hours', status: 'ready' },
    { id: 'mpd-non-emergency', label: 'Police non-emergency', destination: '414-933-4444', availability: 'Partner approval pending', status: 'limited' },
  ],
  weeklyImpact: [
    { label: 'Conflict mediation', referrals: 29 },
    { label: 'Basic needs', referrals: 21 },
    { label: 'Mental health', referrals: 14 },
    { label: 'City services', referrals: 9 },
  ],
};

type VoiceDashboardResponse = {
  stats: {
    total_calls: number;
    emergency_redirects: number;
    referrals_offered: number;
    transfers_connected: number;
    follow_ups_completed: number;
    categories: { category: string; count: number }[];
  };
  active_referrals: {
    id: string;
    category?: string;
    resource_name: string;
    status: string;
    urgency_tier?: string;
    neighborhood?: string;
    created_at: string;
  }[];
  routes: {
    id: string;
    slug: string;
    name: string;
    category: string;
    description: string;
    languages: string[];
    hours_label?: string;
    transfer_approved: boolean;
  }[];
};

function referralStatus(status: string): ReferralStatus {
  if (status === 'connected') return 'connected';
  if (status === 'accepted' || status === 'transfer_attempted') return 'connecting';
  if (status === 'unavailable' || status === 'declined') return 'follow-up';
  return 'new';
}

function fromApi(value: VoiceDashboardResponse): CommunityResponseDashboard {
  const offered = value.stats.referrals_offered;
  return {
    generatedAt: new Date().toISOString(),
    stats: {
      callsToday: value.stats.total_calls,
      connectedRate: offered ? Math.round(value.stats.transfers_connected / offered * 100) : 0,
      emergencyRedirects: value.stats.emergency_redirects,
      openFollowUps: value.active_referrals.filter((item) => item.status === 'unavailable').length,
    },
    activeReferrals: value.active_referrals.map((item) => ({
      id: item.id,
      receivedAt: item.created_at,
      category: item.category ?? 'Community support',
      generalArea: item.neighborhood ?? 'Milwaukee area',
      urgency: item.urgency_tier === 'urgent' || item.urgency_tier === 'emergency' ? 'priority' : 'routine',
      status: referralStatus(item.status),
      summary: 'The assistant retained only the service category and handoff outcome. No free-form transcript or case narrative is available.',
      language: 'Not retained',
      destination: item.resource_name,
    })),
    routes: value.routes.map((item) => ({
      id: item.id,
      label: item.category,
      destination: item.name,
      availability: item.hours_label ?? item.languages.join(', '),
      status: item.transfer_approved ? 'ready' : 'limited',
    })),
    weeklyImpact: value.stats.categories.map((item) => ({ label: item.category, referrals: item.count })),
  };
}

async function fetchDashboard(): Promise<{ dashboard: CommunityResponseDashboard; isDemo: boolean }> {
  try {
    return { dashboard: fromApi(await request<VoiceDashboardResponse>('/voice/dashboard')), isDemo: false };
  } catch {
    // The voice backend may not be deployed while a responder is demoing the
    // mobile client. Keep the experience honest by labeling synthetic data.
    return { dashboard: DEMO_DASHBOARD, isDemo: true };
  }
}

export function useCommunityResponseDashboard() {
  return useQuery({
    queryKey: keys.communityResponse,
    queryFn: fetchDashboard,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

type ResponderOutcome = 'connected' | 'follow_up_needed' | 'completed';

export function useRecordResponderOutcome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ referralId, status }: { referralId: string; status: ResponderOutcome }) =>
      request(`/voice/referrals/${referralId}/responder-outcome`, { method: 'POST', body: { status } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.communityResponse }),
  });
}
