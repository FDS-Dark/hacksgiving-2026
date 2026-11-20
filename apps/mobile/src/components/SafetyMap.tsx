import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, type MapPressEvent } from 'react-native-maps';

import { Txt } from '@/components/ui';
import type { SafetyPoint } from '@/services/publicSafety';
import type { RecentCall } from '@/services/recentCalls';
import { milesBetween } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

const MILWAUKEE_REGION = {
  latitude: 43.045,
  longitude: -87.95,
  latitudeDelta: 0.29,
  longitudeDelta: 0.25,
};

type HeatCell = { id: string; latitude: number; longitude: number; count: number };

function heatCells(points: SafetyPoint[]): HeatCell[] {
  const size = 0.018;
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

export function SafetyMap({
  points,
  recentCalls = [],
  onSelectArea,
}: {
  points: SafetyPoint[];
  recentCalls?: RecentCall[];
  onSelectArea?: (points: SafetyPoint[]) => void;
}) {
  const theme = useTheme();
  const [selectedCoordinate, setSelectedCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const cells = useMemo(() => heatCells(points), [points]);
  const reports = points.filter((point) => point.category === 'community-report');

  const selectArea = (event: MapPressEvent) => {
    const coordinate = event.nativeEvent.coordinate;
    setSelectedCoordinate(coordinate);
    const selected = points
      .filter((point) => point.category !== 'community-report' && milesBetween(coordinate, point) <= 1.5)
      .sort((a, b) => (a.ageInDays ?? 31) - (b.ageInDays ?? 31))
      .slice(0, 25);
    onSelectArea?.(selected);
  };

  return (
    <View style={[styles.frame, { backgroundColor: theme.surface }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={MILWAUKEE_REGION}
        showsCompass
        showsScale
        toolbarEnabled={false}
        onPress={selectArea}
        accessibilityLabel="Interactive Milwaukee map showing recent public safety activity"
      >
        {cells.flatMap((cell) => {
          const center = { latitude: cell.latitude, longitude: cell.longitude };
          const radius = Math.min(1900, 850 + cell.count * 55);
          return [
            <Circle key={`${cell.id}-outer`} center={center} radius={radius} fillColor="rgba(42,117,187,0.12)" strokeColor="transparent" />,
            <Circle key={`${cell.id}-middle`} center={center} radius={radius * 0.66} fillColor="rgba(244,208,63,0.19)" strokeColor="transparent" />,
            <Circle key={`${cell.id}-hot`} center={center} radius={radius * 0.34} fillColor="rgba(198,32,38,0.34)" strokeColor="transparent" />,
          ];
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
        {selectedCoordinate ? <Marker coordinate={selectedCoordinate} pinColor="#1F5F8B" title="Selected area" /> : null}
      </MapView>

      <View style={[styles.legend, { backgroundColor: `${theme.surface}F2` }]} pointerEvents="none">
        <Txt variant="caption" tone="secondary" style={{ fontWeight: '700' }}>{points.filter((point) => point.category !== 'community-report').length} INCIDENTS · 30 DAYS</Txt>
        <View style={styles.legendRow}>
          <View style={[styles.gradient, { backgroundColor: '#2A75BB' }]} />
          <Txt variant="caption" tone="secondary">Lower</Txt>
          <View style={[styles.gradient, { backgroundColor: '#C62026' }]} />
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
