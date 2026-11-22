/**
 * Tasks (/v1/tasks): the follow-ups planned for each case. Their keys sit
 * under 'cases', so any case change refreshes them too.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { CreateTask, Task, TaskFilters, UpdateTask } from '@/api/types';
import { useInvalidateCase } from '@/services/cases';

/** The list path. queryString drops `false`, but the API defaults open_only to
 * true, so the Done tab must send open_only=false explicitly or it only ever
 * sees open tasks. */
export function tasksPath(filters: Partial<TaskFilters>): string {
  return `/tasks${queryString({ ...filters, open_only: filters.open_only === false ? 'false' : filters.open_only })}`;
}

export const tasksApi = {
  list: (filters: Partial<TaskFilters>) => request<Task[]>(tasksPath(filters)),
  create: (caseId: string, body: CreateTask) => request<Task>(`/cases/${caseId}/tasks`, { method: 'POST', body }),
  update: (id: string, body: UpdateTask) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body }),
};

export const taskKeys = {
  list: (filters: Partial<TaskFilters>) => ['cases', 'tasks', filters] as const,
};

export function useTasks(filters: Partial<TaskFilters>, enabled = true) {
  return useQuery({ queryKey: taskKeys.list(filters), queryFn: () => tasksApi.list(filters), refetchInterval: 30_000, enabled });
}

/** A task a worker adds to a case by hand. */
export function useCreateTask(caseId: string) {
  const invalidate = useInvalidateCase();
  return useMutation({ mutationFn: (body: CreateTask) => tasksApi.create(caseId, body), onSuccess: () => invalidate(caseId) });
}

export function useUpdateTask() {
  const invalidate = useInvalidateCase();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTask }) => tasksApi.update(id, body),
    onSuccess: (task) => invalidate(task.case_id),
  });
}
