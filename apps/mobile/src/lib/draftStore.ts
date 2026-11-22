/**
 * Where drafts live on this device: one small JSON file each in the app's
 * documents folder on phones (a typed debrief can be 20,000 characters,
 * more than SecureStore is meant to hold), and localStorage on the web.
 * Drafts stay on the device and are never sent anywhere until saved.
 */
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { DraftStore } from '@/lib/drafts';

const fileFor = (key: string) => new File(Paths.document, `${key.replace(/[^\w.-]/g, '_')}.json`);

export const deviceDraftStore: DraftStore =
  Platform.OS === 'web'
    ? {
        get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
        set: async (key, value) => globalThis.localStorage?.setItem(key, value),
        remove: async (key) => globalThis.localStorage?.removeItem(key),
      }
    : {
        get: async (key) => {
          const file = fileFor(key);
          return file.exists ? file.text() : null;
        },
        set: async (key, value) => {
          const file = fileFor(key);
          if (!file.exists) file.create();
          await file.write(value);
        },
        remove: async (key) => {
          const file = fileFor(key);
          if (file.exists) file.delete();
        },
      };
