import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Tooltip } from '@/components/charts/LineChart';
import { niceTicks, useChartTheme } from '@/theme/chart';
import { space, useTheme } from '@/theme/tokens';

/**
 * Ranked horizontal bars, one hue, largest first: comparing parts of a
 * whole. Value at each bar tip; bars 14px, 4px rounded data end, square
 * at the baseline.
 */
export function RankedBars({
  items,
  color,
  unit,
  format = (v) => v.toLocaleString('en-US'),
  share = 'total',
}: {
  items: { name: string; value: number }[];
  color: string;
  unit: string;
  format?: (value: number) => string;
  /** The % beside each value: of the total, of the first row (a funnel), or none. */
  share?: 'total' | 'first' | 'none';
}) {
  const theme = useTheme();
  const max = Math.max(...items.map((i) => i.value), 1);
  const base = share === 'first' ? items[0]?.value : items.reduce((s, i) => s + i.value, 0);
  return (
    <View style={{ gap: space.sm }}>
      {items.map((it) => (
        <View key={it.name} accessible accessibilityLabel={`${it.name}: ${format(it.value)} ${unit}`} style={styles.rankRow}>
          <Text numberOfLines={1} style={[styles.rankName, { color: theme.text }]}>
            {it.name}
          </Text>
          <View style={styles.rankTrack}>
            <View style={[styles.rankBar, { width: `${(it.value / max) * 66}%`, backgroundColor: color }]} />
            <Text style={[styles.rankValue, { color: theme.textSecondary }]}>
              {format(it.value)}
              {share === 'none' ? null : <Text style={{ color: theme.textTertiary }}> · {Math.round((it.value / (base || 1)) * 100)}%</Text>}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Grouped columns: a few series per x on one y-scale. Columns <= 24px,
 * 2px surface gap between neighbors, 4px rounded tops. Each group is its
 * own hit target with a tooltip listing every series.
 */
export function GroupedColumns({
  labels,
  tipLabels = labels,
  series,
  height = 200,
}: {
  labels: string[];
  tipLabels?: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
}) {
  const theme = useTheme();
  const chart = useChartTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const left = 30;
  const bottom = 24;
  const plotH = height - bottom - 8;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - left);
  const group = labels.length ? plotW / labels.length : 0;
  const col = Math.min(24, Math.max(4, (group * 0.7 - (series.length - 1) * 2) / series.length));
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 56))));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <>
          {ticks.map((t) => (
            <View key={t} style={[styles.grid, { top: 8 + plotH - (t / top) * plotH, left, backgroundColor: t === 0 ? chart.baseline : chart.grid }]} />
          ))}
          {ticks.map((t) => (
            <Text key={`l${t}`} style={[styles.yTick, { top: 8 + plotH - (t / top) * plotH - 8, width: left - 6, color: theme.textTertiary }]}>
              {t}
            </Text>
          ))}
          <View style={[styles.groups, { left, top: 8, height: plotH }]}>
            {labels.map((l, i) => (
              <Pressable
                key={i}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((a) => (a === i ? null : a))}
                onPressIn={() => setActive(i)}
                onFocus={() => setActive(i)}
                accessibilityLabel={`${l}: ${series.map((s) => `${s.name} ${s.values[i]}`).join(', ')}`}
                style={[styles.group, { width: group, backgroundColor: active === i ? theme.fill : 'transparent' }]}
              >
                {series.map((s) => (
                  <View
                    key={s.name}
                    style={{
                      width: col,
                      height: Math.max(s.values[i] ? 2 : 0, (s.values[i] / top) * plotH),
                      backgroundColor: s.color,
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                    }}
                  />
                ))}
              </Pressable>
            ))}
          </View>
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <Text key={i} style={[styles.xTick, { left: left + i * group + group / 2 - 30, top: height - bottom + 6, color: theme.textTertiary }]}>
                {l}
              </Text>
            ) : null,
          )}
          {active !== null ? (
            <Tooltip x={left + active * group + group / 2} width={width}>
              <Text style={[styles.tipTitle, { color: theme.textSecondary }]}>{tipLabels[active]}</Text>
              {series.map((s) => (
                <View key={s.name} style={styles.tipRow}>
                  <View style={[styles.tipKey, { backgroundColor: s.color }]} />
                  <Text style={[styles.tipValue, { color: theme.text }]}>{s.values[active]}</Text>
                  <Text style={[styles.tipName, { color: theme.textSecondary }]}>{s.name}</Text>
                </View>
              ))}
            </Tooltip>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rankName: { width: '38%', maxWidth: 240, fontSize: 14 },
  rankTrack: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rankBar: { height: 14, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  rankValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  grid: { position: 'absolute', right: 0, height: 1 },
  yTick: { position: 'absolute', left: 0, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  groups: { position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'flex-end' },
  group: { height: '100%', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2, borderRadius: 4 },
  xTick: { position: 'absolute', width: 60, textAlign: 'center', fontSize: 11 },
  tipTitle: { fontSize: 12, fontWeight: '600' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipKey: { width: 10, height: 10, borderRadius: 2 },
  tipValue: { fontSize: 14, fontWeight: '700' },
  tipName: { fontSize: 12, flexShrink: 1 },
});

/**
 * Diverging columns: above/below a zero baseline (over/under a plan).
 * One hue per side (the diverging pair), 4px rounded at the data end,
 * square at the baseline; each column is its own hover/tap target.
 */
export function DivergingColumns({
  labels,
  values,
  format,
  posColor,
  negColor,
  height = 200,
}: {
  labels: string[];
  values: number[];
  format: (v: number) => string;
  posColor: string;
  negColor: string;
  height?: number;
}) {
  const theme = useTheme();
  const chart = useChartTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const left = 44;
  const bottom = 22;
  const plotH = height - bottom - 8;
  const top = niceTicks(Math.max(...values.map(Math.abs), 1), 2).at(-1)!;
  const mid = 8 + plotH / 2;
  const y = (v: number) => mid - (v / top) * (plotH / 2);
  const plotW = Math.max(0, width - left);
  const slot = labels.length ? plotW / labels.length : 0;
  const col = Math.min(24, slot * 0.6);
  const labelEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 44))));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <>
          {[top, top / 2, 0, -top / 2, -top].map((t) => (
            <View key={t} style={[styles.grid, { top: y(t), left, backgroundColor: t === 0 ? chart.baseline : chart.grid }]} />
          ))}
          {[top, 0, -top].map((t) => (
            <Text key={`l${t}`} style={[styles.yTick, { top: y(t) - 8, width: left - 6, color: theme.textTertiary }]}>
              {t === 0 ? '0' : `${t < 0 ? '−' : '+'}${format(Math.abs(t))}`}
            </Text>
          ))}
          <View style={[styles.groups, { left, top: 8, height: plotH, alignItems: 'stretch' }]}>
            {labels.map((l, i) => {
              const v = values[i];
              const h = Math.abs(y(v) - mid);
              return (
                <Pressable
                  key={i}
                  onHoverIn={() => setActive(i)}
                  onHoverOut={() => setActive((a) => (a === i ? null : a))}
                  onPressIn={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  accessibilityLabel={`${l}: ${v >= 0 ? 'over' : 'under'} plan by ${format(Math.abs(v))}`}
                  style={{ width: slot, alignItems: 'center', backgroundColor: active === i ? theme.fill : 'transparent', borderRadius: 4 }}
                >
                  <View
                    style={{
                      position: 'absolute',
                      width: col,
                      height: Math.max(v ? 2 : 0, h),
                      top: v >= 0 ? mid - 8 - h : mid - 8,
                      backgroundColor: v >= 0 ? posColor : negColor,
                      borderTopLeftRadius: v >= 0 ? 4 : 0,
                      borderTopRightRadius: v >= 0 ? 4 : 0,
                      borderBottomLeftRadius: v < 0 ? 4 : 0,
                      borderBottomRightRadius: v < 0 ? 4 : 0,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
          {labels.map((l, i) =>
            i % labelEvery === 0 ? (
              <Text key={i} style={[styles.xTick, { left: left + i * slot + slot / 2 - 30, top: height - bottom + 6, color: theme.textTertiary }]}>
                {l}
              </Text>
            ) : null,
          )}
          {active !== null ? (
            <Tooltip x={left + active * slot + slot / 2} width={width}>
              <Text style={[styles.tipTitle, { color: theme.textSecondary }]}>{labels[active]}</Text>
              <View style={styles.tipRow}>
                <View style={[styles.tipKey, { backgroundColor: values[active] >= 0 ? posColor : negColor }]} />
                <Text style={[styles.tipValue, { color: theme.text }]}>{format(Math.abs(values[active]))}</Text>
                <Text style={[styles.tipName, { color: theme.textSecondary }]}>{values[active] >= 0 ? 'over plan' : 'under plan'}</Text>
              </View>
            </Tooltip>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
