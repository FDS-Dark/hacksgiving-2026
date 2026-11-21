/**
 * The signed-in user (/v1/me).
 */
import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { AppUser, UpdateMe } from '@/api/types';

export const userApi = {
  me: () => request<AppUser>('/me'),
  updateMe: (changes: UpdateMe) => request<AppUser>('/me', { method: 'PATCH', body: changes }),
};

export const userKeys = {
  me: ['me'] as const,
};

export function useMe() {
  return useQuery({ queryKey: userKeys.me, queryFn: userApi.me });
}
