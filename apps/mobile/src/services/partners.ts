/**
 * Partners (/v1/partners, Figma P1) and sharing a case with one, with the
 * person's consent (/v1/cases/{id}/shares, Figma P2), plus what the
 * requester was texted about a case (/v1/cases/{id}/texts). Staff only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { CaseCategory, CaseShare, CaseText, CreateShare, Partner, PartnerBody, SharedCase } from '@/api/types';
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
};

export const partnerKeys = {
  all: ['partners'] as const,
  list: (q: string, category: CaseCategory | null) => ['partners', 'list', q, category] as const,
  detail: (id: string) => ['partners', 'detail', id] as const,
  shares: (caseId: string) => ['partners', 'shares', caseId] as const,
  texts: (caseId: string) => ['partners', 'texts', caseId] as const,
};

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
