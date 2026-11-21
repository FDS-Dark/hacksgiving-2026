import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Txt } from '@/components/ui';
import { ESCAPE_HTML_JS, LEAFLET_CSS, LEAFLET_JS, MILWAUKEE, safeJson } from '@/lib/leaflet';
import { INCIDENT_CATEGORIES, type SafetyPoint } from '@/services/publicSafety';
import { callCategory, milesBetween, type RecentCall } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

export type AreaSelection = {
  center: { latitude: number; longitude: number };
  incidents: SafetyPoint[];
  calls: RecentCall[];
};

type HeatCell = { latitude: number; longitude: number; count: number };

function heatCells(points: SafetyPoint[]) {
  const size = 0.012;
  const cells = new Map<string, HeatCell>();
  for (const point of points) {
    if (point.category === 'community-report') continue;
    const latitude = Math.round(point.latitude / size) * size;
    const longitude = Math.round(point.longitude / size) * size;
    const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
    const current = cells.get(key);
    if (current) current.count += 1;
    else cells.set(key, { latitude, longitude, count: 1 });
  }
  return [...cells.values()];
}

function mapHtml(points: SafetyPoint[], calls: RecentCall[]) {
  const cells = heatCells(points);
  const maxCount = Math.max(1, ...cells.map((cell) => cell.count));
  const heat = cells.map((cell) => [cell.latitude, cell.longitude, Math.max(0.12, cell.count / maxCount)]);
  const recentPins = points
    .filter((point) => point.category !== 'community-report' && (point.ageInDays ?? 31) <= 7)
    .sort((a, b) => (a.ageInDays ?? 31) - (b.ageInDays ?? 31))
    .slice(0, 220)
    .map((point) => ({
      id: point.id,
      lat: point.latitude,
      lng: point.longitude,
      label: INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident',
      color: INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.color ?? '#5A6569',
      time: point.reportedAt ? new Date(point.reportedAt).toLocaleString() : `${point.ageInDays ?? 'Recent'} days ago`,
      detail: point.weaponUsed ? `Weapon detail: ${point.weaponUsed}` : 'No additional public detail',
    }));
  const callPins = calls
    .filter((call): call is RecentCall & { latitude: number; longitude: number } => call.latitude !== undefined && call.longitude !== undefined)
    .slice(0, 600)
    .map((call) => ({
      id: call.id,
      lat: call.latitude,
      lng: call.longitude,
      label: call.nature,
      color: callCategory(call.category).color,
      time: `${call.occurredAt} · ${call.block}`,
      detail: `911 call · ${callCategory(call.category).label} · District ${call.district} · ${call.status}`,
    }));

  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
${LEAFLET_CSS}
<style>
html,body,#map{height:100%;width:100%;margin:0;background:#e9edef} .leaflet-control-attribution{font-size:9px}
.leaflet-popup-content-wrapper{border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.leaflet-popup-content{margin:12px 14px;line-height:1.35}
.pin-title{font-size:14px;font-weight:700;margin-bottom:4px}.pin-time{font-size:12px;color:#4f5b60}.pin-detail{font-size:11px;color:#6f797d;margin-top:4px}
</style></head><body><div id="map"></div>
${LEAFLET_JS}
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<script>
const heat=${safeJson(heat)}; const incidents=${safeJson(recentPins)}; const calls=${safeJson(callPins)};
const map=L.map('map',{zoomControl:true,minZoom:10,maxZoom:18}).setView([${MILWAUKEE.latitude},${MILWAUKEE.longitude}],11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap · MPD public data'}).addTo(map);
if(L.heatLayer){L.heatLayer(heat,{radius:34,blur:26,maxZoom:15,minOpacity:.28,gradient:{.12:'#2a75bb',.32:'#36b37e',.52:'#f4d03f',.72:'#f08a24',1:'#c62026'}}).addTo(map);}
else{heat.forEach(p=>L.circle([p[0],p[1]],{radius:700,stroke:false,fillColor:'#e54b25',fillOpacity:.22}).addTo(map));}
function addPin(pin,live){const marker=L.circleMarker([pin.lat,pin.lng],{radius:live?7:5,color:live?'#141a1d':'#fff',weight:live?3:2,fillColor:pin.color,fillOpacity:.96});marker.bindPopup('<div class="pin-title">'+escapeHtml(pin.label)+'</div><div class="pin-time">'+escapeHtml(pin.time)+'</div><div class="pin-detail">'+escapeHtml(pin.detail)+(live?' · Unconfirmed call':' · Generalized location')+'</div>');marker.addTo(map);}
${ESCAPE_HTML_JS}
incidents.forEach(p=>addPin(p,false)); calls.forEach(p=>addPin(p,true));
map.on('click',e=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'area',latitude:e.latlng.lat,longitude:e.latlng.lng})));
</script></body></html>`;
}

export function SafetyMap({
  points,
  recentCalls = [],
  onSelectArea,
}: {
  points: SafetyPoint[];
  recentCalls?: RecentCall[];
  onSelectArea?: (selection: AreaSelection) => void;
}) {
  const theme = useTheme();
  const html = useMemo(() => mapHtml(points, recentCalls), [points, recentCalls]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; latitude?: number; longitude?: number };
      if (message.type !== 'area' || typeof message.latitude !== 'number' || typeof message.longitude !== 'number') return;
      const center = { latitude: message.latitude, longitude: message.longitude };
      const incidents = points
        .filter((point) => point.category !== 'community-report' && milesBetween(center, point) <= 1.5)
        .sort((a, b) => (a.ageInDays ?? 31) - (b.ageInDays ?? 31));
      const calls = recentCalls
        .filter((call): call is RecentCall & { latitude: number; longitude: number } => call.latitude !== undefined && call.longitude !== undefined)
        .filter((call) => milesBetween(center, call) <= 1.5);
      onSelectArea?.({ center, incidents, calls });
    } catch {
      // Ignore malformed messages from web content.
    }
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.surface }]}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        allowsInlineMediaPlayback={false}
        style={styles.webview}
      />
      <View style={[styles.legend, { backgroundColor: `${theme.surface}F2` }]} pointerEvents="none">
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
          {points.filter((point) => point.category !== 'community-report').length} INCIDENTS · 30 DAYS
          {recentCalls.length ? ` · ${recentCalls.filter((call) => call.latitude !== undefined).length} 911 CALLS` : ''}
        </Txt>
        <View style={styles.legendRow}>
          <View style={[styles.gradient, { backgroundColor: '#2A75BB' }]} />
          <Txt variant="caption" tone="secondary">Lower</Txt>
          <View style={[styles.gradient, { backgroundColor: '#C62026' }]} />
          <Txt variant="caption" tone="secondary">Higher</Txt>
        </View>
        <Txt variant="caption" tone="secondary">Small pins: reports · dark-ringed pins: 911 calls</Txt>
        <Txt variant="caption" tone="secondary">Tap the map or a pin for details</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 480, borderRadius: radius.lg, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#E9EDEF' },
  legend: { position: 'absolute', left: space.sm, bottom: space.sm, gap: 4, borderRadius: radius.sm, padding: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  gradient: { width: 12, height: 12, borderRadius: 6 },
});
