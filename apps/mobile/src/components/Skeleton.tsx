/**
 * Loading placeholders in the shape of the real screen (Figma E2), never a
 * lone spinner on a main screen. One gentle pulse drives every block.
 */
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type DimensionValue } from 'react-native';

import { space, useTheme } from '@/theme/tokens';

function usePulse() {
  const [value] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

export function Bone({ width = '100%', height = 12, radius = 6 }: { width?: DimensionValue; height?: number; radius?: number }) {
  const theme = useTheme();
  const opacity = usePulse();
  return <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: theme.fill, opacity }} />;
}

/** A card-shaped placeholder: a rule, a title line and a detail line. */
function LineBone() {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <Bone width={4} height={34} radius={2} />
      <View style={{ flex: 1, gap: 8 }}>
        <Bone width="70%" height={13} />
        <Bone width="45%" height={10} />
      </View>
    </View>
  );
}

/** The queue and other case lists while they load. */
export function CaseListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={{ gap: space.sm }} accessible accessibilityLabel="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <LineBone key={i} />
      ))}
    </View>
  );
}

/** Four stat tiles in a row (Today). */
export function TilesSkeleton() {
  const theme = useTheme();
  return (
    <View style={styles.tiles} accessible accessibilityLabel="Loading">
      {Array.from({ length: 4 }, (_, i) => (
        <View key={i} style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <Bone width={28} height={22} />
          <Bone width="70%" height={9} />
        </View>
      ))}
    </View>
  );
}

/** A block of text lines inside a card (details, a place, a request). */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: theme.surface, borderColor: theme.separator }]} accessible accessibilityLabel="Loading">
      <Bone width="55%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, padding: space.md },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, gap: 8, alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: space.md },
  block: { gap: 10, borderWidth: 1, borderRadius: 16, padding: space.lg },
});
