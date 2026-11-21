/**
 * Requests sent without an account, remembered on this device so "My
 * requests" can open them without typing the access code again. Kept in
 * the Keychain/Keystore (SecureStore) on phones and localStorage on the web,
 * like the sign-in session.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface SavedRequest {
  id: string;
  number: number;
  code: string;
  title: string;
  savedAt: string;
}

const KEY = 'hacksgiving.savedRequests';

const store =
  Platform.OS === 'web'
    ? {
        get: async (key: string) => globalThis.localStorage?.getItem(key) ?? null,
        set: async (key: string, value: string) => globalThis.localStorage?.setItem(key, value),
      }
    : { get: SecureStore.getItemAsync, set: SecureStore.setItemAsync };

function isSaved(value: unknown): value is SavedRequest {
  const v = value as SavedRequest;
  return !!v && typeof v.id === 'string' && typeof v.number === 'number' && typeof v.code === 'string';
}

/** Newest first. A broken or missing entry reads as nothing saved. */
export async function loadSavedRequests(): Promise<SavedRequest[]> {
  try {
    const parsed: unknown = JSON.parse((await store.get(KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

export async function saveRequest(request: SavedRequest): Promise<SavedRequest[]> {
  const next = [request, ...(await loadSavedRequests()).filter((r) => r.id !== request.id)].slice(0, 20);
  await store.set(KEY, JSON.stringify(next));
  return next;
}

export async function forgetRequest(id: string): Promise<SavedRequest[]> {
  const next = (await loadSavedRequests()).filter((r) => r.id !== id);
  await store.set(KEY, JSON.stringify(next));
  return next;
}
