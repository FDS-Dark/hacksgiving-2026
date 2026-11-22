/**
 * The web side of the map message bridge (components/MapFrame.web.tsx).
 *
 * The map HTML talks to React with window.ReactNativeWebView.postMessage(str),
 * which react-native-webview provides on native. On web the same HTML runs in
 * an iframe, so withWebBridge() defines that object there and forwards each
 * message to the parent window, tagged with a marker and the frame's id
 * (several maps can share a screen). mapMessageData() is the parent's filter.
 */
import { safeJson } from '@/lib/leaflet';

export const MAP_MESSAGE_MARKER = '__comforceMap';

type BridgeEnvelope = { [MAP_MESSAGE_MARKER]: true; id: string; data: string };

/** The map HTML with the postMessage shim defined before any map script runs. */
export function withWebBridge(html: string, frameId: string) {
  const shim = `<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage({${MAP_MESSAGE_MARKER}:true,id:${safeJson(frameId)},data:String(m)},'*');}};</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (!head || head.index === undefined) return shim + html;
  const at = head.index + head[0].length;
  return html.slice(0, at) + shim + html.slice(at);
}

/** The message string if `data` (a MessageEvent's data) came from this frame's map, else null. */
export function mapMessageData(data: unknown, frameId: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const envelope = data as Partial<BridgeEnvelope>;
  if (envelope[MAP_MESSAGE_MARKER] !== true || envelope.id !== frameId) return null;
  return typeof envelope.data === 'string' ? envelope.data : null;
}
