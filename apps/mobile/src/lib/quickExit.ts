/**
 * Quick exit: leave the app for an ordinary site at once, for someone who
 * may be watched (domestic violence). On the web the page is replaced, so
 * Back doesn't return to it. On a phone the browser opens on the weather
 * and the app goes back to its first screen, with nothing cached on screen.
 */
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { queryClient } from '@/services/queryClient';

export const QUICK_EXIT_URL = 'https://weather.com';

export function quickExit() {
  queryClient.clear();
  if (Platform.OS === 'web') {
    globalThis.location?.replace(QUICK_EXIT_URL);
    return;
  }
  Linking.openURL(QUICK_EXIT_URL).catch(() => undefined);
  if (router.canDismiss()) router.dismissAll();
  router.replace('/');
}
