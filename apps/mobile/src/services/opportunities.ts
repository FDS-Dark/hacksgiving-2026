/**
 * Volunteer, job and education opportunities: residents search the open ones,
 * ComForce staff post them and close them (staff also see closed ones). The
 * data loader imports more from public job boards (docs/data-loader.md).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { Audience, CreateOpportunity, Opportunity, OpportunityKind, OpportunityOrigin } from '@/api/types';

export interface OpportunityFilters {
  q?: string;
  kind?: OpportunityKind | null;
  /** Only postings open to this audience (e.g. second chance). */
  audience?: Audience | null;
  /** manual: staff postings; imported: from the data loader; unset: both. */
  origin?: OpportunityOrigin | null;
  /** Staff only: the API ignores it for everyone else. */
  includeClosed?: boolean;
}

function query({ q, kind, audience, origin, includeClosed }: OpportunityFilters) {
  const params = new URLSearchParams();
  if (q?.trim()) params.set('q', q.trim());
  if (kind) params.set('kind', kind);
  if (audience) params.set('audience', audience);
  if (origin) params.set('origin', origin);
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
