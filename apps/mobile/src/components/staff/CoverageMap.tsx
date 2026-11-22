import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { TractCoverage } from '@/api/types';
import { shadeOf } from '@/lib/coverage';
import { ESCAPE_HTML_JS, LEAFLET_CSS, LEAFLET_JS, MILWAUKEE, OSM_TILES, safeJson } from '@/lib/leaflet';
import { radius, useTheme } from '@/theme/tokens';

export type CoverageLayer = 'need' | 'incidents';

function mapHtml(points: { id: string; lat: number; lng: number; fill: string; size: number; gap: boolean; tip: string }[]) {
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
${LEAFLET_CSS}
<style>html,body,#map{height:100%;width:100%;margin:0;background:#e9edef}.leaflet-control-attribution{font-size:9px}
.tip{font:500 12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#141A1F}</style></head><body><div id="map"></div>
${LEAFLET_JS}
<script>
${ESCAPE_HTML_JS}
const points=${safeJson(points)};
const map=L.map('map',{zoomControl:false}).setView([${MILWAUKEE.latitude},${MILWAUKEE.longitude}],11);
${OSM_TILES}.addTo(map);
points.forEach(p=>{
  const m=L.circleMarker([p.lat,p.lng],{radius:p.size,color:p.gap?'#B42318':'#FFFFFF',weight:p.gap?3:1,fillColor:p.fill,fillOpacity:0.85}).addTo(map);
  m.bindTooltip('<span class="tip">'+escapeHtml(p.tip)+'</span>',{direction:'top'});
  m.on('click',()=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'tract',id:p.id})));
});
</script></body></html>`;
}

/**
 * Census tracts as circles on a Leaflet map: the fill is the layer (a CDC
 * need, or reviewed incidents), the size is ComForce cases there, and a red
 * ring marks a gap (high need, few cases). Tapping one calls onSelect.
 */
export function CoverageMap({ tracts, layer, onSelect }: { tracts: TractCoverage[]; layer: CoverageLayer; onSelect: (geoid: string) => void }) {
  const theme = useTheme();
  const html = useMemo(() => {
    const valueOf = (t: TractCoverage) => (layer === 'need' ? t.need : t.incidents);
    const values = tracts.map(valueOf).filter((v): v is number => typeof v === 'number');
    const points = tracts.map((t) => ({
      id: t.tract_geoid,
      lat: t.latitude,
      lng: t.longitude,
      fill: shadeOf(valueOf(t), values) ?? '#D0D5D8',
      size: 5 + Math.min(12, Math.sqrt(t.cases) * 3),
      gap: layer === 'need' && t.gap,
      tip: `Tract ${t.name} · ${layer === 'need' ? (t.need === null || t.need === undefined ? 'no data' : `${t.need.toFixed(1)}% of adults`) : t.incidents === null || t.incidents === undefined ? 'under 5 incidents' : `${t.incidents} incidents`} · ${t.cases} ComForce case${t.cases === 1 ? '' : 's'}`,
    }));
    return mapHtml(points);
  }, [tracts, layer]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; id?: string };
      if (message.type === 'tract' && typeof message.id === 'string') onSelect(message.id);
    } catch {
      // Ignore malformed messages from web content.
    }
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <WebView source={{ html }} originWhitelist={['*']} onMessage={handleMessage} javaScriptEnabled setSupportMultipleWindows={false} style={styles.webview} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 360, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#E9EDEF' },
});
