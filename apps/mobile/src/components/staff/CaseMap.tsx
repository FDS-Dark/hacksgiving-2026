import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { Case } from '@/api/types';
import { priorityColor } from '@/components/staff/kit';
import { ESCAPE_HTML_JS, LEAFLET_CSS, LEAFLET_JS, MILWAUKEE, OSM_TILES, safeJson } from '@/lib/leaflet';
import { radius, useTheme, type Theme } from '@/theme/tokens';

type Pinned = Case & { latitude: number; longitude: number };

export function isPinned(c: Case): c is Pinned {
  return c.latitude !== null && c.longitude !== null;
}

function mapHtml(theme: Theme, cases: Pinned[]) {
  const pins = cases.map((c) => ({
    id: c.id,
    lat: c.latitude,
    lng: c.longitude,
    label: `#${c.number}`,
    color: priorityColor(theme, c.priority),
  }));
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
  m.on('click',()=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'case',id:p.id})));
  bounds.push([p.lat,p.lng]);
});
if(bounds.length>1)map.fitBounds(bounds,{padding:[40,40],maxZoom:14});else if(bounds.length)map.setView(bounds[0],14);
</script></body></html>`;
}

/**
 * Open cases with a location, as pins colored by priority. Tapping a pin
 * picks the case; the screen shows it below, so the map never reloads.
 */
export function CaseMap({ cases, onSelect }: { cases: Case[]; onSelect: (id: string) => void }) {
  const theme = useTheme();
  const html = useMemo(() => mapHtml(theme, cases.filter(isPinned)), [theme, cases]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
      if (message.type === 'case' && typeof message.id === 'string') onSelect(message.id);
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
  frame: { flex: 1, minHeight: 320, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#E9EDEF' },
});
