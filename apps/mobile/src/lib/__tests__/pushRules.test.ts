import { describe, expect, it } from '@jest/globals';

import { deviceEnvironment, foregroundBehavior, permissionState, pushData, tapRoute, withKindMuted } from '@/lib/pushRules';

function remote(payload: Record<string, unknown>, data: unknown = null) {
  return { request: { content: { data }, trigger: { type: 'push', payload } } };
}

describe('deviceEnvironment', () => {
  it('maps a development build to the APNs sandbox', () => {
    expect(deviceEnvironment('development')).toBe('sandbox');
  });
  it('keeps production', () => {
    expect(deviceEnvironment('production')).toBe('production');
  });
  it('has none on the simulator', () => {
    expect(deviceEnvironment(null)).toBeNull();
  });
});

describe('pushData', () => {
  it('reads n and u next to aps in the raw APNs payload', () => {
    expect(pushData(remote({ aps: { alert: {} }, n: 'abc', u: 1 }))).toEqual({ id: 'abc', urgent: true, request: null });
  });
  it('treats a missing u as not urgent', () => {
    expect(pushData(remote({ aps: {}, n: 'abc' }))).toEqual({ id: 'abc', urgent: false, request: null });
  });
  it('accepts u as a string', () => {
    expect(pushData(remote({ n: 'abc', u: '1' })).urgent).toBe(true);
  });
  it('falls back to content.data', () => {
    expect(pushData({ request: { content: { data: { n: 'x', u: 1 } }, trigger: null } })).toEqual({ id: 'x', urgent: true, request: null });
  });
  it('has no id when there is none', () => {
    expect(pushData({ request: { content: {}, trigger: { type: 'push' } } })).toEqual({ id: null, urgent: false, request: null });
  });
  it('reads the request a signed-out push is about', () => {
    expect(pushData(remote({ aps: {}, n: 'u1', u: 0, r: 'case-1' })).request).toBe('case-1');
  });
});

describe('foregroundBehavior', () => {
  it('shows urgent pushes as a banner with sound', () => {
    expect(foregroundBehavior(true)).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
  });
  it('keeps everything else silent while the app is open', () => {
    expect(foregroundBehavior(false)).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
  });
});

describe('tapRoute', () => {
  it('uses the notification route', () => {
    expect(tapRoute('/staff/cases/1', true)).toBe('/staff/cases/1');
    expect(tapRoute('/help/request/2', false)).toBe('/help/request/2');
  });
  it('sends staff to their inbox when there is no route', () => {
    expect(tapRoute(null, true)).toBe('/staff/notifications');
  });
  it('leaves residents where they are when there is no route', () => {
    expect(tapRoute(undefined, false)).toBeNull();
  });
});

describe('withKindMuted', () => {
  it('mutes a kind once', () => {
    expect(withKindMuted(['reply'], 'request_update', true)).toEqual(['reply', 'request_update']);
    expect(withKindMuted(['request_update'], 'request_update', true)).toEqual(['request_update']);
  });
  it('unmutes a kind and keeps the rest', () => {
    expect(withKindMuted(['reply', 'request_update'], 'request_update', false)).toEqual(['reply']);
    expect(withKindMuted([], 'request_update', false)).toEqual([]);
  });
});

describe('permissionState', () => {
  it('is on when granted or provisional', () => {
    expect(permissionState({ granted: true, canAskAgain: true })).toBe('on');
    expect(permissionState({ granted: false, canAskAgain: true, ios: { status: 3 } })).toBe('on');
  });
  it('is off when never asked', () => {
    expect(permissionState({ granted: false, canAskAgain: true, ios: { status: 0 } })).toBe('off');
  });
  it('is blocked once refused', () => {
    expect(permissionState({ granted: false, canAskAgain: false, ios: { status: 1 } })).toBe('blocked');
  });
});
