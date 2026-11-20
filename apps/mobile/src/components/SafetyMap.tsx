import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

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
        {cells.map((cell) => {
          const size = Math.min(76, 38 + cell.count * 4);
          return (
          <Marker
            key={cell.id}
            coordinate={{ latitude: cell.latitude, longitude: cell.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={1}
          >
            <View style={[styles.heatOuter, { width: size, height: size, borderRadius: size / 2 }]}>
              <View style={[styles.heatMiddle, { width: size * 0.68, height: size * 0.68, borderRadius: size }]}>
                <View style={[styles.heatCore, { width: size * 0.32, height: size * 0.32, borderRadius: size }]} />
              </View>
            </View>
          </Marker>
          );
        })}
        {reports.map((report) => (
          <Marker key={report.id} coordinate={report} title="Community report" description="Unverified, generalized location">
            <View style={[styles.reportMarker, { borderColor: theme.surface }]} />
          </Marker>
        ))}
        {recentCalls
          .filter((call): call is RecentCall & { latitude: number; longitude: number } => call.latitude !== undefined && call.longitude !== undefined)
          .slice(0, 30)
          .map((call) => (
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
  heatOuter: { backgroundColor: 'rgba(177,30,30,0.28)', alignItems: 'center', justifyContent: 'center' },
  heatMiddle: { backgroundColor: 'rgba(232,91,23,0.42)', alignItems: 'center', justifyContent: 'center' },
  heatCore: { backgroundColor: 'rgba(255,205,45,0.82)' },
  callDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#B11E1E' },
  communityDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#247A63' },
  reportMarker: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, backgroundColor: '#247A63' },
  callMarker: { width: 17, height: 17, borderRadius: 9, borderWidth: 3, backgroundColor: '#B11E1E' },
});
