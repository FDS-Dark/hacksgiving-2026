/**
 * Tasks (/v1/tasks): the follow-ups planned for each case. Their keys sit
 * under 'cases', so any case change refreshes them too.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import { queryString, request } from '@/api/client';
import type { Task, TaskFilters, UpdateTask } from '@/api/types';
import { useInvalidateCase } from '@/services/cases';

export const tasksApi = {
  list: (filters: Partial<TaskFilters>) => request<Task[]>(`/tasks${queryString(filters)}`),
  update: (id: string, body: UpdateTask) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body }),
};

export const taskKeys = {
  list: (filters: Partial<TaskFilters>) => ['cases', 'tasks', filters] as const,
};

export function useTasks(filters: Partial<TaskFilters>, enabled = true) {
  return useQuery({ queryKey: taskKeys.list(filters), queryFn: () => tasksApi.list(filters), refetchInterval: 30_000, enabled });
}

export function useUpdateTask() {
  const invalidate = useInvalidateCase();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTask }) => tasksApi.update(id, body),
    onSuccess: (task) => invalidate(task.case_id),
  });
}
