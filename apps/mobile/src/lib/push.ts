/**
 * Push notifications, straight through Apple (APNs) from our API: no Expo
 * push service. This file asks for permission, registers this phone's raw
 * APNs token with the API (PUT /me/devices), shows urgent pushes while the
 * app is open, and opens what a tapped push points at.
 *
 * Expo Go can't receive our pushes (they're signed for our bundle id), and
 * Android waits for FCM. There `pushSupported()` is false and everything here
 * is a no-op; the in-app inbox still works. `expo-notifications` is only
 * ever loaded lazily, behind that check, so Expo Go never evaluates it (on
 * Android it warns at import, and its token auto-registration runs as an
 * import side effect). Screens go through this file, never the module.
 *
 * Nothing here throws: a failure is logged and push just stays off, so it
 * can never break sign-in or a screen.
 */
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as NotificationsModule from 'expo-notifications';
import { router, type Href } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { debug } from '@/lib/debug';
import { deviceEnvironment, foregroundBehavior, permissionState, pushData, tapRoute, type PushPermission } from '@/lib/pushRules';
import { notificationKeys, notificationsApi } from '@/services/notifications';
import { queryClient } from '@/services/queryClient';
import { staffApi, staffKeys } from '@/services/staff';

export type { PushPermission } from '@/lib/pushRules';

type Notifications = typeof NotificationsModule;

/** False in Expo Go, on the web and (until FCM) on Android. */
export function pushSupported(): boolean {
  return Platform.OS === 'ios' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

let loaded: Notifications | null | undefined;

/** expo-notifications, or null where push isn't supported. */
function notifications(): Notifications | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!pushSupported()) return loaded;
  try {
    // Lazy on purpose (see the header): a top-level import would load the
    // module in Expo Go too.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('expo-notifications') as Notifications;
  } catch (e) {
    debug('push · expo-notifications unavailable:', errorText(e));
  }
  return loaded;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);
}

const invalidateInbox = () => {
  queryClient.invalidateQueries({ queryKey: notificationKeys.all });
  queryClient.invalidateQueries({ queryKey: ['oncall'] });
};

// ── Permission ────────────────────────────────────────────────────────────

const permissionListeners = new Set<(state: PushPermission) => void>();

export async function getPermission(): Promise<PushPermission> {
  const N = notifications();
  if (!N) return 'unsupported';
  try {
    return permissionState(await N.getPermissionsAsync());
  } catch (e) {
    debug('push · permission check failed:', errorText(e));
    return 'unsupported';
  }
}

/**
 * Asks for permission when it hasn't been asked yet (only from a moment that
 * makes the reason obvious: going on call, or R6 after a request), and
 * registers this phone once allowed. Returns where permission ended up.
 * Time-sensitive delivery isn't a permission: it comes from the
 * time-sensitive entitlement in app.json plus the payload's interruption level.
 */
export async function ensurePermission(kind: 'staff' | 'resident'): Promise<PushPermission> {
  const N = notifications();
  if (!N) return 'unsupported';
  let state = await getPermission();
  if (state === 'off') {
    try {
      debug('push · asking permission for', kind);
      state = permissionState(await N.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
    } catch (e) {
      debug('push · permission request failed:', errorText(e));
    }
  }
  permissionListeners.forEach((listener) => listener(state));
  if (state === 'on') void registerDevice();
  return state;
}

/** The current permission, refreshed when the app comes back (from Settings, say). */
export function usePushPermission() {
  const [state, setState] = useState<PushPermission | null>(null);
  const refresh = useCallback(() => {
    getPermission().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    permissionListeners.add(setState);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      permissionListeners.delete(setState);
      sub.remove();
    };
  }, [refresh]);
  return { state, refresh };
}

export function openSettings() {
  Linking.openSettings().catch(() => {});
}

// ── Registration ──────────────────────────────────────────────────────────

/** The token this run registered, so sign-out can remove it without asking iOS again. */
let registeredToken: string | null = null;

/**
 * PUT /me/devices with this phone's APNs token, when permission is already
 * granted. Never asks. Safe to call on every launch: the API upserts.
 */
export async function registerDevice(token?: string): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    if ((await getPermission()) !== 'on') return false;
    const environment = deviceEnvironment(await Application.getIosPushNotificationServiceEnvironmentAsync());
    if (!environment) {
      debug('push · no APNs environment (simulator?), not registering');
      return false;
    }
    const value = token ?? (await withTimeout(N.getDevicePushTokenAsync(), 15_000)).data;
    if (typeof value !== 'string' || !value) return false;
    await notificationsApi.registerDevice({ token: value, platform: 'ios', environment, app_version: Application.nativeApplicationVersion });
    registeredToken = value;
    debug('push · registered', environment);
    return true;
  } catch (e) {
    debug('push · register failed:', errorText(e));
    return false;
  }
}

/**
 * DELETE /me/devices/{token}, for sign-out: called while the session is
 * still there, and bounded so a slow network never holds sign-out up.
 */
export async function unregisterDevice(): Promise<void> {
  const N = notifications();
  if (!N) return;
  const remove = async () => {
    const token = registeredToken ?? (await N.getDevicePushTokenAsync()).data;
    registeredToken = null;
    if (typeof token !== 'string' || !token) return;
    await notificationsApi.removeDevice(token);
    debug('push · device removed');
  };
  try {
    // One budget for the whole thing: sign-out waits at most this long.
    await withTimeout(remove(), 3_000);
  } catch (e) {
    debug('push · remove failed:', errorText(e));
  }
}

/**
 * Stops this phone receiving remote pushes at the iOS level, without the
 * API. For sessions that end without a usable token (refresh refused, a
 * 401), when DELETE /me/devices can't be sent: APNs then answers 410 for the
 * old token and the server disables it. The next sign-in registers again.
 */
export async function forgetDevice(): Promise<void> {
  const N = notifications();
  if (!N) return;
  registeredToken = null;
  try {
    await withTimeout(N.unregisterForNotificationsAsync(), 3_000);
    debug('push · unregistered on this phone');
  } catch (e) {
    debug('push · unregister failed:', errorText(e));
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────

const handled = new Set<string>();

/** A tapped push: look the notification up (which marks it read) and open its route. */
async function openFromPush(N: Notifications, response: NotificationsModule.NotificationResponse) {
  if (response.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER) return;
  // The collapse id (the notification id) can come back as the identifier
  // on a re-sent push, so the delivery date is part of the key.
  const key = `${response.notification.request.identifier}@${response.notification.date}`;
  if (handled.has(key)) return;
  handled.add(key);
  N.clearLastNotificationResponseAsync().catch(() => {});

  const { id } = pushData(response.notification);
  let route: string | null = null;
  if (id) {
    try {
      route = (await notificationsApi.get(id)).route;
    } catch (e) {
      debug('push · notification lookup failed:', errorText(e));
    }
  }
  invalidateInbox();
  // Asked even with a route: on a cold start this is the same query that
  // sends staff from / to /staff, so waiting for it lets that redirect
  // happen first instead of replacing the screen pushed here.
  const isStaff = await queryClient
    .fetchQuery({ queryKey: staffKeys.me, queryFn: staffApi.me })
    .then((me) => me.is_worker)
    .catch(() => false);
  const target = tapRoute(route, isStaff);
  if (target) router.push(target as Href);
}

/**
 * Mount once, in the root layout. Sets the foreground handler; while signed
 * in, registers this phone (if already allowed), follows token changes and
 * opens tapped pushes, including the one that launched the app.
 */
export function usePush(signedIn: boolean) {
  useEffect(() => {
    const N = notifications();
    if (!N) return;
    try {
      N.setNotificationHandler({
        handleNotification: async (notification) => {
          invalidateInbox();
          return foregroundBehavior(pushData(notification).urgent);
        },
      });
    } catch (e) {
      debug('push · handler setup failed:', errorText(e));
    }
    return () => N.setNotificationHandler(null);
  }, []);

  useEffect(() => {
    const N = notifications();
    if (!N || !signedIn) return;
    void registerDevice();
    const subs: { remove: () => void }[] = [];
    try {
      subs.push(
        N.addPushTokenListener((token) => {
          // Only subscribed while signed in (the cleanup removes it).
          if (typeof token.data === 'string') void registerDevice(token.data);
        }),
        N.addNotificationResponseReceivedListener((response) => {
          openFromPush(N, response).catch((e) => debug('push · open failed:', errorText(e)));
        }),
      );
      N.getLastNotificationResponseAsync()
        .then((response) => (response ? openFromPush(N, response) : undefined))
        .catch((e) => debug('push · cold-start open failed:', errorText(e)));
    } catch (e) {
      debug('push · listener setup failed:', errorText(e));
    }
    return () => subs.forEach((sub) => sub.remove());
  }, [signedIn]);
}

// ── R6: the resident ask ──────────────────────────────────────────────────

const ASKED_KEY = 'hacksgiving.pushAsked';

/** R6 shows once per device (SecureStore, like savedRequests). */
async function residentAsked(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ASKED_KEY)) === '1';
  } catch {
    return true;
  }
}

export async function markResidentAsked(): Promise<void> {
  try {
    await SecureStore.setItemAsync(ASKED_KEY, '1');
  } catch {
    // Worst case R6 shows once more.
  }
}

/** Whether to show R6 now: signed in, push works here, never asked (by us or iOS). */
export async function shouldAskResident(signedIn: boolean): Promise<boolean> {
  if (!signedIn || !pushSupported()) return false;
  if ((await getPermission()) !== 'off') return false;
  return !(await residentAsked());
}
