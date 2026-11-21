import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useChartTheme } from '@/theme/chart';
import { radius, space, useTheme } from '@/theme/tokens';

/**
 * Heatmap: rows × columns of counts on the sequential ramp (more = darker
 * in light mode, brighter in dark mode), 2px surface gaps, a scale legend,
 * and the hovered or tapped cell read out above the grid.
 */
export function Heatmap({ rows, columns, values, unit }: { rows: readonly string[]; columns: readonly string[]; values: number[][]; unit: string }) {
  const theme = useTheme();
  const chart = useChartTheme();
  const [active, setActive] = useState<[number, number] | null>(null);
  const flat = values.flat();
  const max = Math.max(...flat, 1);
  const steps = chart.sequential.length;
  const step = (v: number) => Math.min(steps - 1, Math.floor((v / max) * steps));
  const peak = flat.indexOf(max);
  const shown = active ?? [Math.floor(peak / columns.length), peak % columns.length];

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[styles.readout, { color: theme.text }]}>
        {rows[shown[0]]} {columns[shown[1]]}:{' '}
        <Text style={{ fontWeight: '800' }}>
          {values[shown[0]][shown[1]]} {unit}
        </Text>
        {active ? '' : <Text style={{ color: theme.textSecondary }}> (busiest)</Text>}
      </Text>
      <View style={styles.hmRow}>
        <View style={styles.hmLabel} />
        {columns.map((c) => (
          <Text key={c} style={[styles.hmCol, { color: theme.textTertiary }]} numberOfLines={1}>
            {c}
          </Text>
        ))}
      </View>
      {rows.map((r, ri) => (
        <View key={r} style={styles.hmRow}>
          <Text style={[styles.hmLabel, { color: theme.textSecondary }]}>{r}</Text>
          {columns.map((c, ci) => {
            const on = active?.[0] === ri && active?.[1] === ci;
            return (
              <Pressable
                key={c}
                onHoverIn={() => setActive([ri, ci])}
                onHoverOut={() => setActive(null)}
                onPressIn={() => setActive([ri, ci])}
                onFocus={() => setActive([ri, ci])}
                accessibilityLabel={`${r} ${c}: ${values[ri][ci]} ${unit}`}
                style={[styles.cell, { backgroundColor: chart.sequential[step(values[ri][ci])], borderColor: on ? theme.text : 'transparent' }]}
              />
            );
          })}
        </View>
      ))}
      <View style={styles.scale}>
        <Text style={[styles.scaleText, { color: theme.textTertiary }]}>Fewer</Text>
        {chart.sequential.map((c) => (
          <View key={c} style={[styles.scaleStep, { backgroundColor: c }]} />
        ))}
        <Text style={[styles.scaleText, { color: theme.textTertiary }]}>More</Text>
      </View>
    </View>
  );
}

/**
 * Meter list: one ratio per row against a goal. Fill on a lighter track
 * of the same ramp, a goal tick, the figure in text ink, and an icon +
 * label (never color alone) when a row is under goal.
 */
export function MeterList({
  items,
  goal,
  overIsBad = false,
  status,
}: {
  items: { name: string; detail: string; value: number }[];
  goal: number;
  /** For spend vs pace: past the tick is the problem, not short of it. */
  overIsBad?: boolean;
  /** Status line under each bar; defaults to under/meets the goal. */
  status?: (value: number, bad: boolean) => string;
}) {
  const theme = useTheme();
  const chart = useChartTheme();
  const pct = Math.round(goal * 100);
  const label = status ?? ((_: number, bad: boolean) => (bad ? `Under the ${pct}% goal` : `Meets the ${pct}% goal`));
  return (
    <View style={{ gap: space.lg }}>
      {items.map((it) => {
        const under = overIsBad ? it.value > goal : it.value < goal;
        return (
          <View key={it.name} style={{ gap: 6 }} accessible accessibilityLabel={`${it.name}: ${Math.round(it.value * 100)}%. ${label(it.value, under)}.`}>
            <View style={styles.meterHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.meterName, { color: theme.text }]}>{it.name}</Text>
                <Text style={[styles.meterDetail, { color: theme.textSecondary }]}>{it.detail}</Text>
              </View>
              <Text style={[styles.meterValue, { color: theme.text }]}>{Math.round(it.value * 100)}%</Text>
            </View>
            <View style={[styles.track, { backgroundColor: chart.track }]}>
              <View style={[styles.fill, { width: `${Math.min(1, it.value) * 100}%`, backgroundColor: chart.series[0] }]} />
              <View style={[styles.goal, { left: `${goal * 100}%`, backgroundColor: theme.text }]} />
            </View>
            <View style={styles.status}>
              <Ionicons name={under ? 'alert-circle' : 'checkmark-circle'} size={14} color={under ? theme.soon : theme.accent} />
              <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                {label(it.value, under)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Tall segmented bar: one whole split into <= 6 parts. Each block shows
 * its share inside when it fits; the legend names the parts in block order.
 */
export function SegmentedBar({ parts }: { parts: { name: string; value: number }[] }) {
  const theme = useTheme();
  const chart = useChartTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const gaps = (parts.filter((p) => p.value > 0).length - 1) * 2;

  return (
    <View style={{ gap: space.md }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={styles.segBar}
        accessible
        accessibilityLabel={parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(', ')}
      >
        {width > 0
          ? parts.map((p, i) => {
              if (!p.value) return null;
              const w = ((width - gaps) * p.value) / total;
              const share = `${Math.round((p.value / total) * 100)}%`;
              return (
                <Pressable
                  key={p.name}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive(null)}
                  onPressIn={() => setActive(i)}
                  style={[styles.seg, { width: w, backgroundColor: chart.series[i], opacity: active === null || active === i ? 1 : 0.55 }]}
                >
                  {w >= 40 ? <Text style={[styles.segText, { color: chart.onSeries[i] }]}>{share}</Text> : null}
                </Pressable>
              );
            })
          : null}
      </View>
      <Text style={[styles.readout, { color: theme.textSecondary, minHeight: 20 }]}>
        {active !== null
          ? `${parts[active].name}: ${parts[active].value.toLocaleString('en-US')} (${Math.round((parts[active].value / total) * 100)}%)`
          : 'Hover or tap a block for its count.'}
      </Text>
      <View style={styles.legend}>
        {parts.map((p, i) => (
          <View key={p.name} style={styles.legendItem}>
            <View style={[styles.key, { backgroundColor: chart.series[i] }]} />
            <Text style={[styles.legendText, { color: theme.textSecondary }]}>{p.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { fontSize: 14 },
  hmRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  hmLabel: { width: 36, fontSize: 12 },
  hmCol: { flex: 1, fontSize: 10, textAlign: 'center' },
  cell: { flex: 1, height: 26, borderRadius: 3, borderWidth: 2 },
  scale: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs, alignSelf: 'flex-end' },
  scaleStep: { width: 18, height: 10, borderRadius: 2 },
  scaleText: { fontSize: 11, marginHorizontal: 4 },
  meterHead: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  meterName: { fontSize: 15, fontWeight: '700' },
  meterDetail: { fontSize: 12 },
  meterValue: { fontSize: 20, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, overflow: 'visible' },
  fill: { height: 10, borderRadius: 5 },
  goal: { position: 'absolute', top: -3, width: 2, height: 16, marginLeft: -1, borderRadius: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12 },
  segBar: { flexDirection: 'row', gap: 2, height: 28 },
  seg: { height: 28, borderRadius: 4, justifyContent: 'center', paddingHorizontal: 6 },
  segText: { fontSize: 12, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  key: { width: 10, height: 10, borderRadius: radius.sm / 3 },
  legendText: { fontSize: 13 },
});
