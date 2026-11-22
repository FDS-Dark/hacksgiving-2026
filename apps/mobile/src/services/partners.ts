/**
 * Partners (/v1/partners, Figma P1) and sharing a case with one, with the
 * person's consent (/v1/cases/{id}/shares, Figma P2), plus what the
 * requester was texted about a case (/v1/cases/{id}/texts), and asking a
 * partner for help with a case (/v1/cases/{id}/partner-requests). Staff only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Platform } from 'react-native';

import { queryString, request } from '@/api/client';
import type {
  CaseCategory,
  CaseShare,
  CaseText,
  CreatePartnerRequest,
  CreateShare,
  Partner,
  PartnerBody,
  PartnerRequest,
  SentPartnerRequest,
  SharedCase,
} from '@/api/types';
import { caseKeys } from '@/services/cases';

export const partnersApi = {
  list: (q?: string, category?: CaseCategory | null) =>
    request<Partner[]>(`/partners${queryString({ q, category: category ?? undefined })}`),
  get: (id: string) => request<Partner>(`/partners/${id}`),
  create: (body: PartnerBody) => request<Partner>('/partners', { method: 'POST', body }),
  update: (id: string, body: PartnerBody) => request<Partner>(`/partners/${id}`, { method: 'PUT', body }),
  shares: (caseId: string) => request<CaseShare[]>(`/cases/${caseId}/shares`),
  share: (caseId: string, body: CreateShare) => request<SharedCase>(`/cases/${caseId}/shares`, { method: 'POST', body }),
  revoke: (caseId: string, shareId: string) => request<CaseShare>(`/cases/${caseId}/shares/${shareId}/revoke`, { method: 'POST' }),
  texts: (caseId: string) => request<CaseText[]>(`/cases/${caseId}/texts`),
  requests: (caseId: string) => request<PartnerRequest[]>(`/cases/${caseId}/partner-requests`),
  requestHelp: (caseId: string, body: CreatePartnerRequest) =>
    request<SentPartnerRequest>(`/cases/${caseId}/partner-requests`, { method: 'POST', body }),
};

export const partnerKeys = {
  all: ['partners'] as const,
  list: (q: string, category: CaseCategory | null) => ['partners', 'list', q, category] as const,
  detail: (id: string) => ['partners', 'detail', id] as const,
  shares: (caseId: string) => ['partners', 'shares', caseId] as const,
  texts: (caseId: string) => ['partners', 'texts', caseId] as const,
  requests: (caseId: string) => ['partners', 'requests', caseId] as const,
};

/** Who asked which partner for what on a case, newest first. */
export function usePartnerRequests(caseId: string) {
  return useQuery({ queryKey: partnerKeys.requests(caseId), queryFn: () => partnersApi.requests(caseId), enabled: !!caseId });
}

/** Asking a partner for help also writes the case's history, so the case refreshes too. */
export function useRequestPartnerHelp(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePartnerRequest) => partnersApi.requestHelp(caseId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.requests(caseId) });
      qc.invalidateQueries({ queryKey: caseKeys.detail(caseId) });
    },
  });
}

/** The message as an sms: link to the partner's phone (opens the worker's own Messages). */
export function smsLink(phone: string, body: string) {
  return `sms:${phone.replace(/[^\d+]/g, '')}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

export function usePartners(q = '', category: CaseCategory | null = null) {
  return useQuery({ queryKey: partnerKeys.list(q, category), queryFn: () => partnersApi.list(q || undefined, category) });
}

export function usePartner(id: string) {
  return useQuery({ queryKey: partnerKeys.detail(id), queryFn: () => partnersApi.get(id), enabled: !!id });
}

export function useSavePartner(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PartnerBody) => (id ? partnersApi.update(id, body) : partnersApi.create(body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerKeys.all }),
  });
}

export function useCaseShares(caseId: string) {
  return useQuery({ queryKey: partnerKeys.shares(caseId), queryFn: () => partnersApi.shares(caseId), enabled: !!caseId });
}

export function useCaseTexts(caseId: string) {
  return useQuery({ queryKey: partnerKeys.texts(caseId), queryFn: () => partnersApi.texts(caseId), enabled: !!caseId });
}

/** A share also writes the case's history, so the case refreshes too. */
export function useShareCase(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShare) => partnersApi.share(caseId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.shares(caseId) });
      qc.invalidateQueries({ queryKey: caseKeys.detail(caseId) });
    },
  });
}

export function useRevokeShare(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (shareId: string) => partnersApi.revoke(caseId, shareId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerKeys.shares(caseId) });
      qc.invalidateQueries({ queryKey: caseKeys.detail(caseId) });
    },
  });
}

/** The API's sharing errors in words, keeping the server's message. */
export const SHARE_ERRORS: Record<string, string> = {
  consent_required: 'Ask first. Share only the details the person approved.',
  partner_not_accepting: "That partner hasn't agreed to receive shared cases.",
  already_shared: 'This case is already shared with that partner.',
};

/** The message, as a mailto: link to the partner (opens the worker's own email). */
export function shareMailto(email: string, subject: string, body: string) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
