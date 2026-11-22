import type { StyleProp, ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface MapFrameProps {
  /** A full Leaflet HTML document (see lib/leaflet.ts). */
  html: string;
  /** Each string the page sends with window.ReactNativeWebView.postMessage. */
  onMessage: (data: string) => void;
  style?: StyleProp<ViewStyle>;
  /** Native only: lets the page use localStorage. */
  domStorageEnabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * Where every map's HTML runs: a WebView on native. MapFrame.web.tsx is the
 * web build's iframe with the same props, so map components never branch.
 */
export function MapFrame({ html, onMessage, style, domStorageEnabled, accessibilityLabel }: MapFrameProps) {
  return (
    <WebView
      source={{ html }}
      originWhitelist={['*']}
      onMessage={(event: WebViewMessageEvent) => onMessage(event.nativeEvent.data)}
      javaScriptEnabled
      domStorageEnabled={domStorageEnabled}
      setSupportMultipleWindows={false}
      allowsInlineMediaPlayback={false}
      accessibilityLabel={accessibilityLabel}
      style={style}
    />
  );
}
