import { describe, expect, it } from '@jest/globals';

import { mapMessageData, withWebBridge } from '@/lib/mapBridge';

describe('mapMessageData', () => {
  const pin = JSON.stringify({ type: 'pin', id: 'c1' });

  it('returns the message sent by this frame', () => {
    expect(mapMessageData({ __comforceMap: true, id: ':r1:', data: pin }, ':r1:')).toBe(pin);
  });

  it('ignores another map on the same screen', () => {
    expect(mapMessageData({ __comforceMap: true, id: ':r2:', data: pin }, ':r1:')).toBeNull();
  });

  it('ignores messages without the marker or with non-string data', () => {
    expect(mapMessageData({ id: ':r1:', data: pin }, ':r1:')).toBeNull();
    expect(mapMessageData({ __comforceMap: 'yes', id: ':r1:', data: pin }, ':r1:')).toBeNull();
    expect(mapMessageData({ __comforceMap: true, id: ':r1:', data: { type: 'pin' } }, ':r1:')).toBeNull();
    expect(mapMessageData(pin, ':r1:')).toBeNull();
    expect(mapMessageData(null, ':r1:')).toBeNull();
  });
});

describe('withWebBridge', () => {
  it('defines the shim right after <head>, before any map script', () => {
    const html = withWebBridge('<!doctype html><html><head><script src="leaflet.js"></script></head></html>', ':r1:');
    expect(html.indexOf('window.ReactNativeWebView=')).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf('window.ReactNativeWebView=')).toBeLessThan(html.indexOf('leaflet.js'));
  });

  it('forwards postMessage to the parent tagged with the frame id', () => {
    const html = withWebBridge('<html><head></head></html>', ':r1:');
    const script = html.match(/<script>(.*?)<\/script>/)?.[1] ?? '';
    const sent: unknown[] = [];
    const win: { ReactNativeWebView?: { postMessage: (m: string) => void } } = {};
    new Function('window', 'parent', script)(win, { postMessage: (m: unknown) => sent.push(m) });
    win.ReactNativeWebView?.postMessage('hello');
    expect(sent).toEqual([{ __comforceMap: true, id: ':r1:', data: 'hello' }]);
    expect(mapMessageData(sent[0], ':r1:')).toBe('hello');
  });
});
