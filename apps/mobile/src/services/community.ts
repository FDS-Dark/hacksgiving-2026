import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import { keys } from '@/services/queryClient';

export type PublicResource = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  phone_e164: string | null;
  website_url: string | null;
  address_label: string | null;
  latitude: number | null;
  longitude: number | null;
  languages: string[];
  service_area: string;
  hours_label: string | null;
  is_emergency: boolean;
  last_verified_at: string;
};

export type Opportunity = {
  id: string;
  title: string;
  organization: string;
  kind: 'volunteer' | 'job' | 'training';
  summary: string;
  neighborhood: string | null;
  schedule_label: string | null;
  apply_url: string | null;
  posted_at: string;
};

export type AssistanceRequest = {
  id: string;
  category: string;
  summary: string;
  neighborhood: string | null;
  contact_preference: string;
  status: string;
  created_at: string;
};

export type CommunityPost = {
  id: string;
  body: string;
  neighborhood: string | null;
  author_label: string;
  created_at: string;
};

export type CatalogAnswer = {
  answer: string;
  resources: PublicResource[];
  emergency: boolean;
  disclaimer: string;
};

const verifiedAt = '2026-11-21T00:00:00Z';
export const FALLBACK_RESOURCES: PublicResource[] = [
  { id: '911', slug: 'milwaukee-911', name: '911 Emergency Services', category: 'emergency', description: 'Immediate danger, crime in progress, fire, serious injury, weapon, or overdose.', phone_e164: null, website_url: 'https://city.milwaukee.gov/not911', address_label: null, latitude: null, longitude: null, languages: ['en', 'es'], service_area: 'Milwaukee', hours_label: '24/7', is_emergency: true, last_verified_at: verifiedAt },
  { id: '211', slug: 'impact-211', name: 'IMPACT 211', category: 'basic-needs', description: 'Housing, food, health care, family support and other Milwaukee services.', phone_e164: null, website_url: 'https://city.milwaukee.gov/not911', address_label: null, latitude: null, longitude: null, languages: ['en', 'es'], service_area: 'Milwaukee', hours_label: '24/7', is_emergency: false, last_verified_at: verifiedAt },
  { id: 'crisis', slug: 'milwaukee-mobile-crisis', name: 'Milwaukee Mobile Crisis', category: 'mental-health-crisis', description: 'Non-police, 24/7 mental-health crisis response for Milwaukee County.', phone_e164: '+14142577222', website_url: 'https://county.milwaukee.gov/EN/DHHS/BHD/Suicide-Prevention', address_label: null, latitude: null, longitude: null, languages: ['en', 'es'], service_area: 'Milwaukee County', hours_label: '24/7', is_emergency: false, last_verified_at: verifiedAt },
  { id: 'non-emergency', slug: 'mpd-non-emergency', name: 'Police Non-Emergency', category: 'police-non-emergency', description: 'Police reports and assistance when no crime or danger is in progress.', phone_e164: '+14149334444', website_url: 'https://city.milwaukee.gov/not911', address_label: null, latitude: null, longitude: null, languages: ['en'], service_area: 'Milwaukee', hours_label: '24/7', is_emergency: false, last_verified_at: verifiedAt },
  { id: 'mhec', slug: 'mental-health-emergency-center', name: 'Mental Health Emergency Center', category: 'mental-health-crisis', description: '24/7 crisis assessment and stabilization for children and adults.', phone_e164: '+14149663030', website_url: 'https://county.milwaukee.gov/EN/DHHS/BHD/Mental-Health-Emergency-Center', address_label: '1525 N. 12th Street, Milwaukee', latitude: 43.0508, longitude: -87.9273, languages: ['en'], service_area: 'Milwaukee County', hours_label: '24/7', is_emergency: false, last_verified_at: verifiedAt },
];

export const FALLBACK_OPPORTUNITIES: Opportunity[] = [
  { id: 'volunteer', title: 'Community outreach volunteer', organization: 'ComForce MKE', kind: 'volunteer', summary: 'Support resident outreach, resource sharing and safer-neighborhood events.', neighborhood: 'Milwaukee', schedule_label: 'Flexible', apply_url: null, posted_at: verifiedAt },
  { id: 'training', title: 'Violence-prevention training', organization: 'ComForce MKE', kind: 'training', summary: 'Learn community-centered de-escalation, outreach and resource-navigation practices.', neighborhood: 'Milwaukee', schedule_label: 'Upcoming sessions', apply_url: null, posted_at: verifiedAt },
];

export const communityApi = {
  resources: (query = '') => request<PublicResource[]>(`/community/resources${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  assistant: (query: string) => request<CatalogAnswer>(`/community/assistant?q=${encodeURIComponent(query)}`),
  opportunities: () => request<Opportunity[]>('/community/opportunities'),
  requests: () => request<AssistanceRequest[]>('/community/requests'),
  createRequest: (body: { category: string; summary: string; neighborhood?: string }) => request<AssistanceRequest>('/community/requests', { method: 'POST', body }),
  feed: () => request<CommunityPost[]>('/community/feed'),
  createPost: (body: { body: string; neighborhood?: string; anonymous: boolean }) => request<CommunityPost>('/community/feed', { method: 'POST', body }),
};

export function useCommunityResources(query = '') {
  return useQuery({ queryKey: [...keys.communityResources, query], queryFn: () => communityApi.resources(query) });
}

export function useOpportunities() {
  return useQuery({ queryKey: keys.communityOpportunities, queryFn: communityApi.opportunities });
}

export function useAssistanceRequests() {
  return useQuery({ queryKey: keys.assistanceRequests, queryFn: communityApi.requests });
}

export function useCommunityFeed() {
  return useQuery({ queryKey: keys.communityFeed, queryFn: communityApi.feed });
}

export function useCreateAssistanceRequest() {
  const client = useQueryClient();
  return useMutation({ mutationFn: communityApi.createRequest, onSuccess: () => client.invalidateQueries({ queryKey: keys.assistanceRequests }) });
}

export function useCreateCommunityPost() {
  const client = useQueryClient();
  return useMutation({ mutationFn: communityApi.createPost, onSuccess: () => client.invalidateQueries({ queryKey: keys.communityFeed }) });
}
