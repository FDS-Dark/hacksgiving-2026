/**
 * Case management: the ComForce worker portal's server data (staff only).
 * A resident's own requests are in requests.ts.
 * Keys live here, not in queryClient.ts, so this domain stays self-contained.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
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
  CreateResource,
  DraftMessage,
  Referral,
  Resource,
  ResourceSuggestions,
  Role,
  StaffMember,
  StaffStatus,
  Task,
  TaskFilters,
  UpdateCase,
  UpdateReferral,
  UpdateTask,
  UserSummary,
  Worker,
} from '@/api/types';

function query(params: Record<string, string | number | boolean | null | undefined>) {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
  return pairs.length ? `?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')}` : '';
}

export const staffApi = {
  me: () => request<StaffStatus>('/staff/me'),
  bootstrap: () => request<StaffMember>('/staff/bootstrap', { method: 'POST' }),
  workers: () => request<Worker[]>('/staff/workers'),
  users: () => request<UserSummary[]>('/staff/users'),
  setRole: (userId: string, role: Role) => request<StaffMember>(`/staff/users/${userId}/role`, { method: 'PATCH', body: { role } }),
};

export const casesApi = {
  list: (filters: Partial<CaseFilters>) => request<Case[]>(`/cases${query(filters)}`),
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

export const resourcesApi = {
  list: (q?: string, category?: string | null) => request<Resource[]>(`/resources${query({ q, category })}`),
  create: (body: CreateResource) => request<Resource>('/resources', { method: 'POST', body }),
};

export const tasksApi = {
  list: (filters: Partial<TaskFilters>) => request<Task[]>(`/tasks${query(filters)}`),
  update: (id: string, body: UpdateTask) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body }),
};

export const caseKeys = {
  all: ['cases'] as const,
  list: (filters: Partial<CaseFilters>) => ['cases', 'list', filters] as const,
  detail: (id: string) => ['cases', 'detail', id] as const,
  insights: ['cases', 'insights'] as const,
  staffMe: ['staff', 'me'] as const,
  workers: ['staff', 'workers'] as const,
  users: ['staff', 'users'] as const,
  resources: (q?: string, category?: string | null) => ['resources', q ?? '', category ?? ''] as const,
  tasks: (filters: Partial<TaskFilters>) => ['cases', 'tasks', filters] as const,
};

// ── Staff ──────────────────────────────────────────────────────────────────

export function useStaffStatus() {
  return useQuery({ queryKey: caseKeys.staffMe, queryFn: staffApi.me });
}

export function useBootstrapStaff() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: staffApi.bootstrap, onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }) });
}

export function useWorkers() {
  return useQuery({ queryKey: caseKeys.workers, queryFn: staffApi.workers });
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: caseKeys.users, queryFn: staffApi.users, enabled });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => staffApi.setRole(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });
}

// ── Cases ──────────────────────────────────────────────────────────────────

export function useCases(filters: Partial<CaseFilters>, enabled = true) {
  return useQuery({ queryKey: caseKeys.list(filters), queryFn: () => casesApi.list(filters), refetchInterval: 30_000, enabled });
}

export function useCase(id: string) {
  return useQuery({ queryKey: caseKeys.detail(id), queryFn: () => casesApi.get(id) });
}

export function useInsights() {
  return useQuery({ queryKey: caseKeys.insights, queryFn: casesApi.insights, refetchInterval: 30_000 });
}

/** After any change to a case: its detail, every list, the dashboard and the worker loads. */
function useInvalidateCase() {
  const qc = useQueryClient();
  return (id?: string) => {
    if (id) qc.invalidateQueries({ queryKey: caseKeys.detail(id) });
    qc.invalidateQueries({ queryKey: caseKeys.all });
    qc.invalidateQueries({ queryKey: caseKeys.workers });
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

// ── Resources ──────────────────────────────────────────────────────────────

export function useResources(q?: string, category?: string | null) {
  return useQuery({ queryKey: caseKeys.resources(q, category), queryFn: () => resourcesApi.list(q, category) });
}

export function useCreateResource() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: resourcesApi.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['resources'] }) });
}

// ── Tasks ────────────────────────────────────────────────────────────────

/** Tasks live under the 'cases' key, so any case change refreshes them too. */
export function useTasks(filters: Partial<TaskFilters>, enabled = true) {
  return useQuery({ queryKey: caseKeys.tasks(filters), queryFn: () => tasksApi.list(filters), refetchInterval: 30_000, enabled });
}

export function useUpdateTask() {
  const invalidate = useInvalidateCase();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTask }) => tasksApi.update(id, body),
    onSuccess: (task) => invalidate(task.case_id),
  });
}
