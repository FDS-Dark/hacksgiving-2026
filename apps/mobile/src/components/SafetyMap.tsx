import { StyleSheet, Text, View } from 'react-native';

import type { SafetyPoint } from '@/services/publicSafety';
import { INCIDENT_CATEGORIES } from '@/services/publicSafety';
import { radius, type, useTheme } from '@/theme/tokens';

const BOUNDS = { north: 43.19, south: 42.9, east: -87.84, west: -88.08 };
const COMMUNITY_COLOR = '#247A63';

function colorFor(category: SafetyPoint['category']) {
  if (category === 'community-report') return COMMUNITY_COLOR;
  return INCIDENT_CATEGORIES.find((item) => item.id === category)?.color ?? '#6B7280';
}

function position(point: SafetyPoint) {
  const left = ((point.longitude - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * 100;
  const top = ((BOUNDS.north - point.latitude) / (BOUNDS.north - BOUNDS.south)) * 100;
  return {
    left: `${Math.min(96, Math.max(2, left))}%` as `${number}%`,
    top: `${Math.min(94, Math.max(2, top))}%` as `${number}%`,
  };
}

export function SafetyMap({ points }: { points: SafetyPoint[] }) {
  const theme = useTheme();
  const displayedPoints = [
    ...INCIDENT_CATEGORIES.flatMap((category) => points.filter((point) => point.category === category.id).slice(0, 45)),
    ...points.filter((point) => point.category === 'community-report').slice(0, 45),
  ];
  return (
    <View
      style={[styles.map, { backgroundColor: theme.scheme === 'dark' ? '#172126' : '#E8ECE8' }]}
      accessibilityRole="image"
      accessibilityLabel={`Milwaukee activity map with ${points.length} visible locations`}
    >
      <View style={styles.lake} />
      <View style={[styles.road, styles.roadOne]} />
      <View style={[styles.road, styles.roadTwo]} />
      <View style={[styles.road, styles.roadThree]} />
      <Text style={[type.footnote, styles.cityLabel, { color: theme.textSecondary }]}>MILWAUKEE</Text>
      <Text style={[type.caption, styles.lakeLabel]}>LAKE MICHIGAN</Text>
      {displayedPoints.map((point) => {
        const color = colorFor(point.category);
        return (
          <View key={point.id} style={[styles.pointWrap, position(point)]}>
            <View style={[styles.heat, { backgroundColor: color }]} />
            <View style={[styles.dot, { backgroundColor: color, borderColor: theme.surface }]} />
          </View>
        );
      })}
      <View style={[styles.disclaimer, { backgroundColor: `${theme.surface}E8` }]}>
        <Text style={[type.caption, { color: theme.textSecondary }]}>Generalized locations · patterns, not predictions</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 370, borderRadius: radius.lg, overflow: 'hidden', position: 'relative' },
  lake: { position: 'absolute', right: -45, top: 0, bottom: 0, width: '30%', backgroundColor: '#9ED3E7', borderTopLeftRadius: 80, borderBottomLeftRadius: 130 },
  road: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 4 },
  roadOne: { width: '86%', height: 4, top: '43%', left: '-8%', transform: [{ rotate: '-8deg' }] },
  roadTwo: { width: 4, height: '94%', left: '47%', top: '-4%', transform: [{ rotate: '7deg' }] },
  roadThree: { width: '76%', height: 3, top: '72%', left: '1%', transform: [{ rotate: '12deg' }] },
  cityLabel: { position: 'absolute', left: 18, top: 16, fontWeight: '700', letterSpacing: 1.5 },
  lakeLabel: { position: 'absolute', right: -21, top: '47%', color: '#2E6D86', fontWeight: '700', letterSpacing: 1, transform: [{ rotate: '90deg' }] },
  pointWrap: { position: 'absolute', width: 18, height: 18, marginLeft: -9, marginTop: -9, alignItems: 'center', justifyContent: 'center' },
  heat: { position: 'absolute', width: 36, height: 36, borderRadius: 18, opacity: 0.17 },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  disclaimer: { position: 'absolute', left: 10, bottom: 10, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
});
