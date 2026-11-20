import { useQuery } from '@tanstack/react-query';

import { request } from '@/api/client';
import type { AppUser, UpdateMe } from '@/api/types';
import { keys } from '@/services/queryClient';

export const userApi = {
  me: () => request<AppUser>('/me'),
  updateMe: (changes: UpdateMe) => request<AppUser>('/me', { method: 'PATCH', body: changes }),
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: userApi.me });
}
