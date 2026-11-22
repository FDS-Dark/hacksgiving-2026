/**
 * Requests written with no connection (Figma E3), kept on this device until
 * they can be sent. Same store as saved requests (SecureStore on phones,
 * localStorage on the web): the text can be sensitive, so never plain
 * AsyncStorage.
 *
 * A send that times out may still have reached the API, so a resend can
 * make a duplicate request. Staff can close a duplicate; a lost request for
 * help is worse.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { SubmitRequest } from '@/api/types';
import { ApiError } from '@/api/client';

export interface PendingRequest {
  /** Local only, never sent. */
  localId: string;
  body: SubmitRequest;
  queuedAt: string;
}

const KEY = 'hacksgiving.pendingRequests';
/** Enough for someone retrying a few times; old ones would be stale anyway. */
const MAX = 5;

const store =
  Platform.OS === 'web'
    ? {
        get: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
        set: async (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
      }
    : { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync };

/** Worth queueing: the phone couldn't reach the API at all. A refusal (4xx)
 *  or a server error is shown on the form instead. */
export function isOffline(e: unknown) {
  return e instanceof ApiError && e.status === 0;
}

function isPending(value: unknown): value is PendingRequest {
  const v = value as PendingRequest;
  return !!v && typeof v.localId === 'string' && typeof v.queuedAt === 'string' && typeof v.body?.description === 'string';
}

/** Oldest first, so they go out in the order they were written. */
export async function loadPending(): Promise<PendingRequest[]> {
  try {
    const parsed: unknown = JSON.parse((await store.get(KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

async function write(list: PendingRequest[]) {
  await store.set(KEY, JSON.stringify(list));
  return list;
}

export async function queueRequest(body: SubmitRequest, now = new Date()): Promise<PendingRequest[]> {
  const entry: PendingRequest = { localId: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, body, queuedAt: now.toISOString() };
  return write([...(await loadPending()), entry].slice(-MAX));
}

export async function removePending(localId: string): Promise<PendingRequest[]> {
  return write((await loadPending()).filter((p) => p.localId !== localId));
}
