/**
 * The pure decisions behind push (lib/push.ts), kept apart from the native
 * modules so they can be tested on their own, like authRefresh.ts for auth.
 */

/** What expo-application reports for the build, and what the API calls it. */
export type ApsEnvironment = 'development' | 'production' | null;
export type DeviceEnvironment = 'sandbox' | 'production';

/** A development build talks to Apple's sandbox; TestFlight and the App Store
 *  to production. `null` (the simulator) can't register at all. */
export function deviceEnvironment(env: ApsEnvironment): DeviceEnvironment | null {
  if (env === 'development') return 'sandbox';
  if (env === 'production') return 'production';
  return null;
}

/** The parts of an expo-notifications Notification this file reads. */
export interface NotificationLike {
  request: {
    content: { data?: unknown };
    trigger?: unknown;
  };
}

export interface PushData {
  /** The notification id (`n`), for GET /notifications/{id}. */
  id: string | null;
  /** `u` = 1: an urgent kind, the only kind that shows while the app is open. */
  urgent: boolean;
  /** `r`: a request sent without an account. There is no inbox row; the
   *  app opens the request itself (the code is saved on this phone). */
  request: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Our keys (`n`, `u`) sit next to `aps` in the APNs payload. expo-notifications
 * only copies a remote push's `body` key into `content.data`, so on iOS they
 * are read from the trigger's raw payload, with `content.data` as a fallback.
 */
export function pushData(notification: NotificationLike): PushData {
  const trigger = record(notification.request.trigger);
  const payload = trigger.type === 'push' ? record(trigger.payload) : {};
  const data = { ...record(notification.request.content.data), ...payload };
  const id = typeof data.n === 'string' && data.n ? data.n : null;
  const request = typeof data.r === 'string' && data.r ? data.r : null;
  return { id, urgent: data.u === 1 || data.u === '1', request };
}

/** How a push that arrives while the app is open is shown: urgent ones as a
 *  banner with sound, everything else silently (the inbox and bell refresh). */
export function foregroundBehavior(urgent: boolean) {
  return {
    shouldShowBanner: urgent,
    shouldShowList: urgent,
    shouldPlaySound: urgent,
    shouldSetBadge: false,
  };
}

/** Where a tapped push opens. With no route (or the lookup failed), staff
 *  land on their inbox; residents stay where they are. */
export function tapRoute(route: string | null | undefined, isStaff: boolean): string | null {
  if (route) return route;
  return isStaff ? '/staff/notifications' : null;
}

/** `muted` with `kind` added (muted) or removed (unmuted), keeping the rest. */
export function withKindMuted<K extends string>(muted: readonly K[], kind: K, mute: boolean): K[] {
  const rest = muted.filter((k) => k !== kind);
  return mute ? [...rest, kind] : rest;
}

/** The system permission, as the Me rows show it. */
export type PushPermission = 'on' | 'off' | 'blocked' | 'unsupported';

/** On: allowed (provisional counts). Off: never asked, so the app can ask.
 *  Blocked: refused, so only Settings can turn it on. */
export function permissionState(status: { granted: boolean; canAskAgain: boolean; ios?: { status: number } | null }): PushPermission {
  // IosAuthorizationStatus: 2 authorized, 3 provisional, 4 ephemeral.
  if (status.granted || (status.ios && status.ios.status >= 2)) return 'on';
  return status.canAskAgain ? 'off' : 'blocked';
}
