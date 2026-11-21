import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { niceTicks, useChartTheme } from '@/theme/chart';
import { radius, space, useTheme } from '@/theme/tokens';

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

const PAD = { top: 12, right: 12, bottom: 26, left: 34 };

/**
 * Multi-line chart on one y-scale: 2px lines, end dots with a surface ring,
 * hairline grid, an optional neutral reference line (a target), and a
 * crosshair that snaps to the nearest x and lists every series.
 */
export function LineChart({
  labels,
  tipLabels = labels,
  series,
  reference,
  unit,
  format = (v) => `${v} ${unit}`,
  height = 220,
}: {
  labels: string[];
  /** Fuller labels for the tooltip (e.g. a date span), when the axis uses short ones. */
  tipLabels?: string[];
  series: LineSeries[];
  /** A neutral target line; name it in the chart's legend. */
  reference?: { value: number };
  unit: string;
  /** How a value reads in the tooltip. */
  format?: (value: number) => string;
  height?: number;
}) {
  const theme = useTheme();
  const chart = useChartTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const n = labels.length;
  const max = Math.max(...series.flatMap((s) => s.values), reference?.value ?? 0);
  const ticks = niceTicks(max * 1.05);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))));
  const slot = n > 1 ? plotW / (n - 1) : plotW;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <>
          <Svg width={width} height={height}>
            {ticks.map((t) => (
              <Line key={t} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? chart.baseline : chart.grid} strokeWidth={1} />
            ))}
            {reference ? (
              <Line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)} stroke={chart.reference} strokeWidth={1} />
            ) : null}
            {active !== null ? <Line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} stroke={chart.baseline} strokeWidth={1} /> : null}
            {series.map((s) => (
              <Path key={s.name} d={path(s.values)} stroke={s.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {series.map((s) => {
              const i = active ?? n - 1;
              return <Circle key={s.name} cx={x(i)} cy={y(s.values[i])} r={4} fill={s.color} stroke={theme.surface} strokeWidth={2} />;
            })}
          </Svg>

          {/* Axis and reference labels in text ink, never series color. */}
          {ticks.map((t) => (
            <Text key={t} style={[styles.yTick, { top: y(t) - 8, color: theme.textTertiary }]}>
              {t}
            </Text>
          ))}
          {labels.map((l, i) =>
            // Every k-th label, plus the last; drop one that would crowd the last.
            (i % labelEvery === 0 && n - 1 - i >= labelEvery * 0.75) || i === n - 1 ? (
              <Text
                key={i}
                style={[styles.xTick, { left: Math.min(Math.max(x(i) - 30, 0), width - 60), top: height - PAD.bottom + 6, color: theme.textTertiary }]}
              >
                {l}
              </Text>
            ) : null,
          )}

          {/* Hit columns: the whole slot around each x is the target, not the 2px line. */}
          <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', left: PAD.left - slot / 2, right: PAD.right - slot / 2, top: PAD.top, bottom: PAD.bottom }]}>
            {labels.map((l, i) => (
              <Pressable
                key={i}
                style={{ flex: 1 }}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive((a) => (a === i ? null : a))}
                onPressIn={() => setActive(i)}
                onFocus={() => setActive(i)}
                accessibilityLabel={`${l}: ${series.map((s) => `${s.name} ${format(s.values[i])}`).join(', ')}`}
              />
            ))}
          </View>

          {active !== null ? (
            <Tooltip x={x(active)} width={width}>
              <Text style={[styles.tipTitle, { color: theme.textSecondary }]}>{tipLabels[active]}</Text>
              {series.map((s) => (
                <View key={s.name} style={styles.tipRow}>
                  <View style={[styles.tipKey, { backgroundColor: s.color }]} />
                  <Text style={[styles.tipValue, { color: theme.text }]}>
                    {format(s.values[active])}
                  </Text>
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

/** A floating readout pinned to the top of a chart near x. */
export function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const theme = useTheme();
  const w = 168;
  // Right of the crosshair, or left of it when it would run off the edge.
  const left = x + 10 + w > width ? Math.max(0, x - w - 10) : x + 10;
  return (
    <View
      pointerEvents="none"
      style={[styles.tip, { left, width: w, backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  yTick: { position: 'absolute', left: 0, width: PAD.left - 6, textAlign: 'right', fontSize: 11, fontVariant: ['tabular-nums'] },
  xTick: { position: 'absolute', width: 60, textAlign: 'center', fontSize: 11 },
  tip: { position: 'absolute', top: 0, gap: 4, padding: space.sm, borderWidth: 1, borderRadius: radius.md },
  tipTitle: { fontSize: 12, fontWeight: '600' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipKey: { width: 12, height: 2, borderRadius: 1 },
  tipValue: { fontSize: 14, fontWeight: '700' },
  tipName: { fontSize: 12, flexShrink: 1 },
});
