/**
 * Staff (/v1/staff): who is a ComForce worker or admin, and managing roles.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { Role, StaffMember, StaffStatus, UserSummary, Worker } from '@/api/types';

export const staffApi = {
  me: () => request<StaffStatus>('/staff/me'),
  bootstrap: () => request<StaffMember>('/staff/bootstrap', { method: 'POST' }),
  workers: () => request<Worker[]>('/staff/workers'),
  users: () => request<UserSummary[]>('/staff/users'),
  setRole: (userId: string, role: Role) => request<StaffMember>(`/staff/users/${userId}/role`, { method: 'PATCH', body: { role } }),
};

export const staffKeys = {
  all: ['staff'] as const,
  me: ['staff', 'me'] as const,
  workers: ['staff', 'workers'] as const,
  users: ['staff', 'users'] as const,
};

export function useStaffStatus() {
  return useQuery({ queryKey: staffKeys.me, queryFn: staffApi.me });
}

/** True only once /staff/me says this account is a worker or admin. */
export function useIsStaff() {
  return useStaffStatus().data?.is_worker ?? false;
}

export function useBootstrapStaff() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: staffApi.bootstrap, onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }) });
}

export function useWorkers() {
  return useQuery({ queryKey: staffKeys.workers, queryFn: staffApi.workers });
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: staffKeys.users, queryFn: staffApi.users, enabled });
}

export function useSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => staffApi.setRole(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  });
}
