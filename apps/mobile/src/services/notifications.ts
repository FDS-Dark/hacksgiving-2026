/**
 * The in-app inbox (/v1/notifications, /v1/me/notification-preferences):
 * any signed-in person's notifications, the unread count behind the bell,
 * and marking things read. Every read invalidates everything under
 * 'notifications', so the bell, the list and the request dots clear together.
 *
 * Also this phone's push registration (/v1/me/devices) and the test push;
 * lib/push.ts decides when to call them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { queryString, request } from '@/api/client';

import type {
  NotificationItem,
  NotificationPreferences,
  ReadAllResult,
  RegisterDevice,
  UnreadCount,
  UpdateNotificationPreferences,
} from '@/api/types';

export type {
  NotificationItem,
  NotificationKind,
  NotificationPreferences,
  ReadAllResult,
  UnreadCount,
  UpdateNotificationPreferences,
} from '@/api/types';

export type { RegisterDevice } from '@/api/types';

export const notificationsApi = {
  list: (params: { before?: string; limit?: number } = {}) => request<NotificationItem[]>(`/notifications${queryString(params)}`),
  /** One notification, and marks it read (a push tap uses its route). */
  get: (id: string) => request<NotificationItem>(`/notifications/${encodeURIComponent(id)}`),
  unreadCount: () => request<UnreadCount>('/notifications/unread-count'),
  read: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: (caseId: string | null = null) => request<ReadAllResult>('/notifications/read-all', { method: 'POST', body: { case_id: caseId } }),
  preferences: () => request<NotificationPreferences>('/me/notification-preferences'),
  updatePreferences: (body: UpdateNotificationPreferences) =>
    request<NotificationPreferences>('/me/notification-preferences', { method: 'PATCH', body }),
  registerDevice: (body: RegisterDevice) => request<void>('/me/devices', { method: 'PUT', body }),
  removeDevice: (token: string) => request<void>(`/me/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  /** 202; 429 `rate_limited` after 3 in 10 minutes. */
  sendTest: () => request<void>('/notifications/test', { method: 'POST' }),
};

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
  preferences: ['notifications', 'preferences'] as const,
};

const POLL_MS = 30_000;
/** The first page; older items (`before`) aren't paged in yet. */
const PAGE = 50;

/** The newest notifications. Pass `enabled: false` when signed out. */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: () => notificationsApi.list({ limit: PAGE }),
    refetchInterval: POLL_MS,
    enabled,
  });
}

/** The bell's count: every 30 s, when the app comes back, and when the screen showing it is focused again. */
export function useUnreadCount(enabled = true) {
  const query = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: notificationsApi.unreadCount,
    refetchInterval: POLL_MS,
    staleTime: 0,
    enabled,
  });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (enabled) refetch({ cancelRefetch: false });
    }, [enabled, refetch]),
  );
  return query;
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: notificationKeys.all });
}

export function useReadNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: notificationsApi.read, onSuccess: invalidate });
}

/** Mark everything read, or (with a case id) everything about one case. */
export function useReadAll() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: (caseId: string | null) => notificationsApi.readAll(caseId), onSuccess: invalidate });
}

/**
 * Opening a case or request marks its notifications read: on open, and
 * again when `version` changes (e.g. its update count, after a poll brings
 * a new reply in). Failures are ignored; the bell just stays lit.
 */
export function useMarkCaseRead(caseId: string | undefined, enabled: boolean, version?: number) {
  const { mutate } = useReadAll();
  useEffect(() => {
    if (caseId && enabled) mutate(caseId);
  }, [caseId, enabled, version, mutate]);
}

export function useNotificationPreferences(enabled = true) {
  return useQuery({ queryKey: notificationKeys.preferences, queryFn: notificationsApi.preferences, enabled });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: (prefs) => qc.setQueryData(notificationKeys.preferences, prefs),
  });
}

/** "Send a test notification" (staff Me). It lands in the inbox too, so the bell refreshes. */
export function useSendTestNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({ mutationFn: notificationsApi.sendTest, onSuccess: invalidate });
}
