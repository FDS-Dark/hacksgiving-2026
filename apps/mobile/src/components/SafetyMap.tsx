import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';

import { Txt } from '@/components/ui';
import type { SafetyPoint } from '@/services/publicSafety';
import type { RecentCall } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

const MILWAUKEE_REGION = {
  latitude: 43.045,
  longitude: -87.95,
  latitudeDelta: 0.29,
  longitudeDelta: 0.25,
};

type HeatCell = { id: string; latitude: number; longitude: number; count: number };

function heatCells(points: SafetyPoint[]): HeatCell[] {
  const size = 0.012;
  const cells = new Map<string, HeatCell>();
  for (const point of points) {
    if (point.category === 'community-report') continue;
    const lat = Math.round(point.latitude / size) * size;
    const lon = Math.round(point.longitude / size) * size;
    const id = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
    const current = cells.get(id);
    if (current) current.count += 1;
    else cells.set(id, { id, latitude: lat, longitude: lon, count: 1 });
  }
  return [...cells.values()];
}

function heatColor(count: number) {
  if (count >= 10) return 'rgba(177, 30, 30, 0.42)';
  if (count >= 5) return 'rgba(223, 94, 24, 0.36)';
  return 'rgba(239, 180, 37, 0.28)';
}

export function SafetyMap({ points, recentCalls = [] }: { points: SafetyPoint[]; recentCalls?: RecentCall[] }) {
  const theme = useTheme();
  const cells = useMemo(() => heatCells(points), [points]);
  const reports = points.filter((point) => point.category === 'community-report');

  return (
    <View style={[styles.frame, { backgroundColor: theme.surface }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={MILWAUKEE_REGION}
        showsCompass
        showsScale
        toolbarEnabled={false}
        accessibilityLabel="Interactive Milwaukee map showing recent public safety activity"
      >
        {cells.map((cell) => (
          <Circle
            key={cell.id}
            center={{ latitude: cell.latitude, longitude: cell.longitude }}
            radius={Math.min(900, 280 + cell.count * 55)}
            fillColor={heatColor(cell.count)}
            strokeColor="rgba(166, 27, 27, 0.10)"
            strokeWidth={1}
          />
        ))}
        {reports.map((report) => (
          <Marker key={report.id} coordinate={report} title="Community report" description="Unverified, generalized location">
            <View style={[styles.reportMarker, { borderColor: theme.surface }]} />
          </Marker>
        ))}
        {recentCalls.slice(0, 30).map((call) => (
          <Marker
            key={call.id}
            coordinate={call}
            title={call.nature}
            description={`Recent police call · District ${call.district}`}
          >
            <View style={[styles.callMarker, { borderColor: theme.surface }]} />
          </Marker>
        ))}
      </MapView>

      <View style={[styles.legend, { backgroundColor: `${theme.surface}F2` }]} pointerEvents="none">
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '700' }}>30-DAY ACTIVITY</Txt>
        <View style={styles.legendRow}>
          <View style={[styles.gradient, { backgroundColor: '#EFB425' }]} />
          <Txt variant="caption" tone="secondary">Lower</Txt>
          <View style={[styles.gradient, { backgroundColor: '#B11E1E' }]} />
          <Txt variant="caption" tone="secondary">Higher</Txt>
        </View>
        <View style={styles.legendRow}>
          <View style={styles.callDot} />
          <Txt variant="caption" tone="secondary">Recent call</Txt>
          <View style={styles.communityDot} />
          <Txt variant="caption" tone="secondary">Community</Txt>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 430, borderRadius: radius.lg, overflow: 'hidden' },
  legend: { position: 'absolute', left: space.sm, bottom: space.sm, gap: 4, borderRadius: radius.sm, padding: space.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  gradient: { width: 12, height: 12, borderRadius: 6 },
  callDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#B11E1E' },
  communityDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#247A63' },
  reportMarker: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, backgroundColor: '#247A63' },
  callMarker: { width: 17, height: 17, borderRadius: 9, borderWidth: 3, backgroundColor: '#B11E1E' },
});
