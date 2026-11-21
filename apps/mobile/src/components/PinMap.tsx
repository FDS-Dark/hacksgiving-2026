import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ESCAPE_HTML_JS, LEAFLET_CSS, LEAFLET_JS, MILWAUKEE, OSM_TILES, safeJson } from '@/lib/leaflet';
import { radius, useTheme } from '@/theme/tokens';

export interface Pin {
  id: string;
  latitude: number;
  longitude: number;
  /** A short tag beside the pin ("#1047", "Harbor House"). */
  label: string;
  color: string;
}

/** Anything with a real location (latitude and longitude both set). */
export function hasLocation<T extends { latitude?: number | null; longitude?: number | null }>(item: T): item is T & { latitude: number; longitude: number } {
  return typeof item.latitude === 'number' && typeof item.longitude === 'number';
}

function mapHtml(points: Pin[]) {
  const pins = points.map((p) => ({ id: p.id, lat: p.latitude, lng: p.longitude, label: p.label, color: p.color }));
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
${LEAFLET_CSS}
<style>
html,body,#map{height:100%;width:100%;margin:0;background:#e9edef}.leaflet-control-attribution{font-size:9px}
.tag{background:#fff;border:1px solid #DCE4E0;border-radius:8px;padding:1px 6px;font:600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141A1F;white-space:nowrap}
</style></head><body><div id="map"></div>
${LEAFLET_JS}
<script>
${ESCAPE_HTML_JS}
const pins=${safeJson(pins)};
const map=L.map('map',{zoomControl:false}).setView([${MILWAUKEE.latitude},${MILWAUKEE.longitude}],12);
${OSM_TILES}.addTo(map);
const bounds=[];
pins.forEach(p=>{
  const m=L.circleMarker([p.lat,p.lng],{radius:8,color:'#fff',weight:2,fillColor:p.color,fillOpacity:1}).addTo(map);
  m.bindTooltip('<span class="tag">'+escapeHtml(p.label)+'</span>',{permanent:true,direction:'right',offset:[8,0],opacity:1,className:''});
  m.on('click',()=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'pin',id:p.id})));
  bounds.push([p.lat,p.lng]);
});
if(bounds.length>1)map.fitBounds(bounds,{padding:[40,40],maxZoom:14});else if(bounds.length)map.setView(bounds[0],14);
</script></body></html>`;
}

/**
 * Pins on a Leaflet map of Milwaukee (staff open cases, resident places).
 * Tapping a pin calls onSelect with its id; the screen shows the details
 * below, so the map itself never reloads.
 */
export function PinMap({ pins, onSelect }: { pins: Pin[]; onSelect: (id: string) => void }) {
  const theme = useTheme();
  const html = useMemo(() => mapHtml(pins), [pins]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
      if (message.type === 'pin' && typeof message.id === 'string') onSelect(message.id);
    } catch {
      // Ignore malformed messages from web content.
    }
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 200, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#E9EDEF' },
});
