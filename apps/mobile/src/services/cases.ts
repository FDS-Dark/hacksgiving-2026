/**
 * Cases (/v1/cases): the ComForce queue, a case's history, referrals,
 * insights and AI assist. Staff only; a resident's own view of their case
 * is in requests.ts.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type {
  AddCaseUpdate,
  AddReferral,
  Case,
  CaseDetail,
  CaseFilters,
  CaseInsights,
  CaseSummary,
  CaseUpdate,
  CreateCase,
  DraftMessage,
  Person,
  Referral,
  ResourceSuggestions,
  UpdateCase,
  UpdateReferral,
} from '@/api/types';
import { staffKeys } from '@/services/staff';

const POLL_MS = 30_000;

export const casesApi = {
  list: (filters: Partial<CaseFilters>) => request<Case[]>(`/cases${queryString(filters)}`),
  get: (id: string) => request<CaseDetail>(`/cases/${id}`),
  create: (body: CreateCase) => request<Case>('/cases', { method: 'POST', body }),
  update: (id: string, body: UpdateCase) => request<Case>(`/cases/${id}`, { method: 'PATCH', body }),
  addUpdate: (id: string, body: AddCaseUpdate) => request<CaseUpdate>(`/cases/${id}/updates`, { method: 'POST', body }),
  insights: () => request<CaseInsights>('/cases/insights'),
  addReferral: (id: string, body: AddReferral) => request<Referral>(`/cases/${id}/referrals`, { method: 'POST', body }),
  updateReferral: (id: string, referralId: string, body: UpdateReferral) =>
    request<Referral>(`/cases/${id}/referrals/${referralId}`, { method: 'PATCH', body }),
  summarize: (id: string) => request<CaseSummary>(`/cases/${id}/assist/summary`, { method: 'POST' }),
  suggestResources: (id: string) => request<ResourceSuggestions>(`/cases/${id}/assist/resources`, { method: 'POST' }),
  draftMessage: (id: string) => request<DraftMessage>(`/cases/${id}/assist/draft-message`, { method: 'POST' }),
};

/** Everything here sits under 'cases' (tasks too), so one invalidation refreshes it all. */
export const caseKeys = {
  all: ['cases'] as const,
  list: (filters: Partial<CaseFilters>) => ['cases', 'list', filters] as const,
  detail: (id: string) => ['cases', 'detail', id] as const,
  insights: ['cases', 'insights'] as const,
};

export function useCases(filters: Partial<CaseFilters>, enabled = true) {
  return useQuery({ queryKey: caseKeys.list(filters), queryFn: () => casesApi.list(filters), refetchInterval: POLL_MS, enabled });
}

export function useCase(id: string) {
  return useQuery({ queryKey: caseKeys.detail(id), queryFn: () => casesApi.get(id) });
}

export function useInsights() {
  return useQuery({ queryKey: caseKeys.insights, queryFn: casesApi.insights, refetchInterval: POLL_MS });
}

/** After any change to a case: its detail, every list, the dashboard, tasks and the worker loads. */
export function useInvalidateCase() {
  const qc = useQueryClient();
  return (id?: string) => {
    if (id) qc.invalidateQueries({ queryKey: caseKeys.detail(id) });
    qc.invalidateQueries({ queryKey: caseKeys.all });
    qc.invalidateQueries({ queryKey: staffKeys.workers });
  };
}

export function useCreateCase() {
  const invalidate = useInvalidateCase();
  return useMutation({ mutationFn: casesApi.create, onSuccess: () => invalidate() });
}

export function useUpdateCase(id: string) {
  const invalidate = useInvalidateCase();
  return useMutation({ mutationFn: (body: UpdateCase) => casesApi.update(id, body), onSuccess: () => invalidate(id) });
}

export function useAddCaseUpdate(id: string) {
  const invalidate = useInvalidateCase();
  return useMutation({ mutationFn: (body: AddCaseUpdate) => casesApi.addUpdate(id, body), onSuccess: () => invalidate(id) });
}

export function useAddReferral(id: string) {
  const invalidate = useInvalidateCase();
  return useMutation({ mutationFn: (body: AddReferral) => casesApi.addReferral(id, body), onSuccess: () => invalidate(id) });
}

export function useUpdateReferral(id: string) {
  const invalidate = useInvalidateCase();
  return useMutation({
    mutationFn: ({ referralId, body }: { referralId: string; body: UpdateReferral }) => casesApi.updateReferral(id, referralId, body),
    onSuccess: () => invalidate(id),
  });
}

/** AI help is fetched on demand (a button), never in the background. */
export function useCaseAssist(id: string) {
  return {
    summary: useMutation({ mutationFn: () => casesApi.summarize(id) }),
    resources: useMutation({ mutationFn: () => casesApi.suggestResources(id) }),
    draft: useMutation({ mutationFn: () => casesApi.draftMessage(id) }),
  };
}

/** The resident behind a case and every case that looks like them (same account, phone or email). */
export function usePerson(caseId: string) {
  return useQuery({
    queryKey: [...caseKeys.all, 'person', caseId] as const,
    queryFn: () => request<Person>(`/cases/${caseId}/person`),
  });
}
