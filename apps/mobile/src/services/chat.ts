/**
 * Team chat (/v1/chat): the Team and On call channels and one per case,
 * staff only. A channel is named by its key: 'team', 'oncall' or a case id.
 *
 * Fresh without websockets: the channel list and an open thread poll every
 * 5 s while their screen is focused, refetch when it's focused again and
 * when the app comes back (queryClient's focusManager), and pull to refresh.
 */
import { hashKey, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { request } from '@/api/client';
import type { ChatChannel, ChatMessage, ChatReadResult, ChatThread, SendChatMessage } from '@/api/types';
import { notificationKeys } from '@/services/notifications';

export type { ChatChannel, ChatMessage, ChatThread } from '@/api/types';

export const chatApi = {
  channels: () => request<ChatChannel[]>('/chat/channels'),
  thread: (key: string) => request<ChatThread>(`/chat/channels/${encodeURIComponent(key)}`),
  send: (key: string, body: SendChatMessage) =>
    request<ChatMessage>(`/chat/channels/${encodeURIComponent(key)}/messages`, { method: 'POST', body }),
  read: (key: string) => request<ChatReadResult>(`/chat/channels/${encodeURIComponent(key)}/read`, { method: 'POST' }),
};

export const chatKeys = {
  all: ['chat'] as const,
  channels: ['chat', 'channels'] as const,
  thread: (key: string) => ['chat', 'thread', key] as const,
};

/** How often an on-screen chat checks for new messages. */
export const CHAT_POLL_MS = 5_000;

/**
 * The poll interval for a query on the calling screen: CHAT_POLL_MS while
 * it's focused, off otherwise. Coming back to the screen refetches at once.
 */
function useFocusPolling(queryKey: QueryKey): number | false {
  const qc = useQueryClient();
  const [focused, setFocused] = useState(true);
  const hash = hashKey(queryKey);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void qc.refetchQueries({ queryKey: JSON.parse(hash) as QueryKey, exact: true });
      return () => setFocused(false);
    }, [qc, hash]),
  );
  return focused ? CHAT_POLL_MS : false;
}

/** The caller's channels with unread counts (Today's Team chat entry, /staff/chat). */
export function useChatChannels() {
  const interval = useFocusPolling(chatKeys.channels);
  return useQuery({ queryKey: chatKeys.channels, queryFn: chatApi.channels, staleTime: 0, refetchInterval: interval });
}

/** One channel and its newest messages, polled while the thread is on screen. */
export function useChatThread(key: string) {
  const interval = useFocusPolling(chatKeys.thread(key));
  return useQuery({
    queryKey: chatKeys.thread(key),
    queryFn: () => chatApi.thread(key),
    enabled: !!key,
    staleTime: 0,
    refetchInterval: key ? interval : false,
  });
}

/** A sent message shows at once (the thread refetches), and the list's preview moves. */
export function useSendChatMessage(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendChatMessage) => chatApi.send(key, body),
    onSuccess: (message) => {
      qc.setQueryData<ChatThread>(chatKeys.thread(key), (thread) =>
        thread && !thread.messages.some((m) => m.id === message.id) ? { ...thread, messages: [...thread.messages, message] } : thread,
      );
      qc.invalidateQueries({ queryKey: chatKeys.all });
    },
  });
}

/** Reading a channel clears its unread count and its inbox rows (so the bell too). */
export function useMarkChatRead(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chatApi.read(key),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: chatKeys.channels });
      if (result.notifications_read) qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Unread totals across channels, for the Today entry. */
export function unreadTotals(channels: readonly ChatChannel[]) {
  return channels.reduce((sum, c) => ({ unread: sum.unread + c.unread, rapid: sum.rapid + c.rapid_unread }), { unread: 0, rapid: 0 });
}
