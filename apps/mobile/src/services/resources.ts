/**
 * Resources (/v1/resources): the partner and program directory. Staff refer
 * people to it; residents browse it on the Nearby tab.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { CreateResource, Resource } from '@/api/types';

export const resourcesApi = {
  list: (q?: string, category?: string | null) => request<Resource[]>(`/resources${queryString({ q, category })}`),
  get: (id: string) => request<Resource>(`/resources/${id}`),
  create: (body: CreateResource) => request<Resource>('/resources', { method: 'POST', body }),
};

export const resourceKeys = {
  all: ['resources'] as const,
  list: (q?: string, category?: string | null) => ['resources', 'list', q ?? '', category ?? ''] as const,
  detail: (id: string) => ['resources', 'detail', id] as const,
};

export function useResources(q?: string, category?: string | null) {
  return useQuery({ queryKey: resourceKeys.list(q, category), queryFn: () => resourcesApi.list(q, category) });
}

export function useResource(id: string) {
  return useQuery({ queryKey: resourceKeys.detail(id), queryFn: () => resourcesApi.get(id) });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: resourcesApi.create, onSuccess: () => qc.invalidateQueries({ queryKey: resourceKeys.all }) });
}
