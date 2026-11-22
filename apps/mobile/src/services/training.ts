/** Worker training progress (/v1/training): which course modules I've finished. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { TrainingProgress } from '@/api/types';

const key = ['training', 'progress'] as const;

export function useTrainingProgress() {
  return useQuery({ queryKey: key, queryFn: () => request<TrainingProgress>('/training/progress') });
}

export function useSetModuleDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, done }: { moduleId: string; done: boolean }) =>
      request<TrainingProgress>(`/training/progress/${moduleId}`, { method: 'PUT', body: { done } }),
    onSuccess: (progress) => qc.setQueryData(key, progress),
  });
}
