import { createElement, useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { mapMessageData, withWebBridge } from '@/lib/mapBridge';

import type { MapFrameProps } from './MapFrame';

/**
 * The web build's MapFrame: the same map HTML in a sandboxed iframe. A shim in
 * the page (lib/mapBridge.ts) forwards window.ReactNativeWebView.postMessage
 * to this window, and only this frame's messages reach onMessage.
 */
export function MapFrame({ html, onMessage, style, accessibilityLabel }: MapFrameProps) {
  const frameId = useId();
  const srcDoc = useMemo(() => withWebBridge(html, frameId), [html, frameId]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const data = mapMessageData(event.data, frameId);
      if (data !== null) onMessage(data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [frameId, onMessage]);

  const background = StyleSheet.flatten(style)?.backgroundColor;
  return (
    <View style={style}>
      {createElement('iframe', {
        srcDoc,
        title: accessibilityLabel ?? 'Map',
        sandbox: 'allow-scripts',
        style: { border: 0, width: '100%', height: '100%', display: 'block', backgroundColor: background },
      })}
    </View>
  );
}
