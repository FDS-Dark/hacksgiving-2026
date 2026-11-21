/**
 * Volunteer and job opportunities: residents search the open ones, ComForce
 * staff post them and close them (staff also see closed ones).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { CreateOpportunity, Opportunity, OpportunityKind } from '@/api/types';

export interface OpportunityFilters {
  q?: string;
  kind?: OpportunityKind | null;
  /** Staff only: the API ignores it for everyone else. */
  includeClosed?: boolean;
}

function query({ q, kind, includeClosed }: OpportunityFilters) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (kind) params.set('kind', kind);
  if (includeClosed) params.set('include_closed', 'true');
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const opportunitiesApi = {
  list: (filters: OpportunityFilters) => request<Opportunity[]>(`/opportunities${query(filters)}`),
  create: (body: CreateOpportunity) => request<Opportunity>('/opportunities', { method: 'POST', body }),
  setActive: (id: string, active: boolean) => request<Opportunity>(`/opportunities/${id}`, { method: 'PATCH', body: { active } }),
};

export const opportunityKeys = {
  all: ['opportunities'] as const,
  list: (filters: OpportunityFilters) => ['opportunities', 'list', filters] as const,
};

export function useOpportunities(filters: OpportunityFilters) {
  return useQuery({
    queryKey: opportunityKeys.list(filters),
    queryFn: () => opportunitiesApi.list(filters),
    // Keep the last results on screen while a new search loads.
    placeholderData: keepPreviousData,
  });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: opportunitiesApi.create, onSuccess: () => qc.invalidateQueries({ queryKey: opportunityKeys.all }) });
}

export function useSetOpportunityActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => opportunitiesApi.setActive(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: opportunityKeys.all }),
  });
}
