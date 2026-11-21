import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Txt } from '@/components/ui';
import { INCIDENT_CATEGORIES, type SafetyPoint } from '@/services/publicSafety';
import { milesBetween, type RecentCall } from '@/services/recentCalls';
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

function callColor(nature: string) {
  const lower = nature.toLowerCase();
  if (lower.includes('shoot') || lower.includes('weapon') || lower.includes('stabbing')) return '#B42318';
  if (lower.includes('assault') || lower.includes('battery') || lower.includes('fight')) return '#D76B18';
  if (lower.includes('robbery') || lower.includes('burglary') || lower.includes('entry')) return '#7A4EAB';
  if (lower.includes('vehicle') || lower.includes('theft')) return '#2877A8';
  return '#5A6569';
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/&/g, '\\u0026');
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
    .slice(0, 100)
    .map((call) => ({
      id: call.id,
      lat: call.latitude,
      lng: call.longitude,
      label: call.nature,
      color: callColor(call.nature),
      time: call.occurredAt,
      detail: `Dispatch call · District ${call.district} · ${call.status}`,
    }));

  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
html,body,#map{height:100%;width:100%;margin:0;background:#e9edef} .leaflet-control-attribution{font-size:9px}
.leaflet-popup-content-wrapper{border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.leaflet-popup-content{margin:12px 14px;line-height:1.35}
.pin-title{font-size:14px;font-weight:700;margin-bottom:4px}.pin-time{font-size:12px;color:#4f5b60}.pin-detail{font-size:11px;color:#6f797d;margin-top:4px}
.crime-pin{width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 7px rgba(12,30,40,.35);display:flex;align-items:center;justify-content:center;box-sizing:border-box}
.crime-pin.live{border-color:#182126}.crime-pin span{transform:rotate(45deg);color:#fff;font-size:15px;font-weight:800;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.25)}
.selected-area{width:27px;height:27px;border-radius:50%;background:#c62026;border:6px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);box-sizing:border-box}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
<script>
const heat=${safeJson(heat)}; const incidents=${safeJson(recentPins)}; const calls=${safeJson(callPins)};
const map=L.map('map',{zoomControl:true,minZoom:10,maxZoom:18}).setView([43.045,-87.95],11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap · MPD public data'}).addTo(map);
if(L.heatLayer){L.heatLayer(heat,{radius:38,blur:29,maxZoom:15,minOpacity:.3,gradient:{.12:'#2a75bb',.32:'#36b37e',.52:'#f4d03f',.72:'#f08a24',1:'#c62026'}}).addTo(map);}
else{heat.forEach(p=>L.circle([p[0],p[1]],{radius:700,stroke:false,fillColor:'#e54b25',fillOpacity:.22}).addTo(map));}
function pinGlyph(label,live){if(live)return '◉';const s=String(label).toLowerCase();if(s.includes('vehicle'))return '◆';if(s.includes('theft')||s.includes('burglary'))return '▣';if(s.includes('assault'))return '⚠';if(s.includes('robbery'))return '●';return '•';}
function addPin(pin,live){const icon=L.divIcon({className:'',html:'<div class="crime-pin '+(live?'live':'')+'" style="background:'+pin.color+'"><span>'+pinGlyph(pin.label,live)+'</span></div>',iconSize:[32,40],iconAnchor:[16,38],popupAnchor:[0,-34]});const marker=L.marker([pin.lat,pin.lng],{icon});marker.bindPopup('<div class="pin-title">'+escapeHtml(pin.label)+'</div><div class="pin-time">'+escapeHtml(pin.time)+'</div><div class="pin-detail">'+escapeHtml(pin.detail)+(live?' · Unconfirmed call':' · Generalized location')+'</div>');marker.addTo(map);}
function escapeHtml(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
incidents.forEach(p=>addPin(p,false)); calls.forEach(p=>addPin(p,true));
let selectedMarker=L.marker([43.045,-87.95],{icon:L.divIcon({className:'',html:'<div class="selected-area"></div>',iconSize:[27,27],iconAnchor:[13,13]),interactive:false}).addTo(map);
map.on('click',e=>{selectedMarker.setLatLng(e.latlng);window.ReactNativeWebView.postMessage(JSON.stringify({type:'area',latitude:e.latlng.lat,longitude:e.latlng.lng}));});
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
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '700' }}>30-DAY DENSITY</Txt>
        <View style={styles.heatScale} />
        <Txt variant="caption" tone="secondary">lower  →  higher</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 540, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: '#E9EDEF' },
  legend: { position: 'absolute', left: space.sm, bottom: 48, gap: 3, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 6 },
  heatScale: { width: 112, height: 7, borderRadius: 4, backgroundColor: '#36B37E', borderLeftWidth: 28, borderLeftColor: '#2A75BB', borderRightWidth: 36, borderRightColor: '#C62026' },
});
