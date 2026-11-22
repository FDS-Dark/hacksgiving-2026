/**
 * Where drafts live on this device: the Keychain/Keystore (SecureStore) on
 * phones, like the sign-in session and saved requests, because a draft
 * holds what the worker typed before any redaction (names, phone numbers).
 * Kept to this device only: not migrated to a new phone from a backup.
 * localStorage on the web. Drafts are never sent anywhere until saved.
 *
 * Expo sets no size limit, but some older iOS versions refused values over
 * about 2 KB; a draft that can't be stored is skipped (DraftKeeper never
 * lets a storage error reach the form).
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { DraftStore } from '@/lib/drafts';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const deviceDraftStore: DraftStore =
  Platform.OS === 'web'
    ? {
        get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
        set: async (key, value) => globalThis.localStorage?.setItem(key, value),
        remove: async (key) => globalThis.localStorage?.removeItem(key),
      }
    : {
        get: (key) => SecureStore.getItemAsync(key, OPTIONS),
        set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
        remove: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
      };
