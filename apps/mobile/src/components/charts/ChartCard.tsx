import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useChartTheme } from '@/theme/chart';
import { radius, space, useTheme } from '@/theme/tokens';

export interface Table {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * A chart in a card: title, one-line takeaway, the chart, a legend, and a
 * "View as table" switch, so no value depends on color or hovering.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  table: Table;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [showTable, setShowTable] = useState(false);
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
          {subtitle ? <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
        </View>
        <Pressable
          onPress={() => setShowTable(!showTable)}
          accessibilityRole="button"
          accessibilityLabel={showTable ? `Show ${title} as a chart` : `Show ${title} as a table`}
          hitSlop={8}
          style={({ pressed }) => [styles.toggle, { backgroundColor: theme.fill }, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name={showTable ? 'bar-chart-outline' : 'grid-outline'} size={15} color={theme.textSecondary} />
          <Text style={[styles.toggleText, { color: theme.textSecondary }]}>{showTable ? 'Chart' : 'Table'}</Text>
        </Pressable>
      </View>
      {showTable ? (
        <DataTable table={table} />
      ) : (
        <>
          {legend}
          {children}
        </>
      )}
    </View>
  );
}

export function DataTable({ table }: { table: Table }) {
  const theme = useTheme();
  const chart = useChartTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View accessibilityRole="list" style={{ minWidth: '100%' }}>
        <View style={[styles.tr, { borderBottomColor: chart.baseline }]}>
          {table.columns.map((c, i) => (
            <Text key={c} style={[styles.th, i > 0 && styles.num, { color: theme.textSecondary }]}>
              {c}
            </Text>
          ))}
        </View>
        {table.rows.map((row, r) => (
          <View key={r} style={[styles.tr, { borderBottomColor: theme.separator }]}>
            {row.map((cell, i) => (
              <Text key={i} style={[styles.td, i > 0 && styles.num, { color: theme.text }]}>
                {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Legend for two or more series: a key that mirrors the mark (line or block) + name in text ink. */
export function Legend({
  items,
  shape = 'block',
}: {
  /** `thin` keys a neutral reference line (a target), drawn 1px like the line itself. */
  items: { label: string; color: string; thin?: boolean }[];
  shape?: 'block' | 'line';
}) {
  const theme = useTheme();
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.legendItem}>
          <View
            style={
              shape === 'line' || it.thin
                ? [styles.keyLine, it.thin && { height: 1 }, { backgroundColor: it.color }]
                : [styles.keyBlock, { backgroundColor: it.color }]
            }
          />
          <Text style={[styles.legendText, { color: theme.textSecondary }]}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A headline number with an optional change vs the previous period. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaUnit = unit,
  lowerIsBetter = false,
  neutral = false,
  footnote,
}: {
  label: string;
  value: string;
  unit?: string;
  /** Change vs the previous period, in the value's units. */
  delta?: number;
  /** Unit for the change when it differs from the value's (e.g. "pts" for a %). */
  deltaUnit?: string;
  lowerIsBetter?: boolean;
  /** Neither direction is good or bad (e.g. call volume): the change shows in plain ink. */
  neutral?: boolean;
  footnote?: string;
}) {
  const theme = useTheme();
  const flat = delta === undefined || Math.abs(delta) < 0.05;
  const good = !flat && (lowerIsBetter ? delta! < 0 : delta! > 0);
  const deltaColor = flat || neutral ? theme.textSecondary : good ? theme.accent : theme.danger;
  const deltaText = flat ? 'No change' : `${delta! > 0 ? '+' : '−'}${formatDelta(Math.abs(delta!))}${deltaUnit ? ` ${deltaUnit}` : ''}`;
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.separator }]} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}. ${delta === undefined ? '' : `${deltaText} vs previous period`}`}>
      <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: theme.text }]}>
        {value}
        {unit ? <Text style={[styles.tileUnit, { color: theme.textSecondary }]}> {unit}</Text> : null}
      </Text>
      {delta !== undefined ? (
        <View style={styles.delta}>
          <Ionicons name={flat ? 'remove' : delta! > 0 ? 'arrow-up' : 'arrow-down'} size={13} color={deltaColor} />
          <Text style={[styles.deltaText, { color: deltaColor }]}>{deltaText}</Text>
          <Text style={[styles.deltaText, { color: theme.textTertiary }]}>vs prior period</Text>
        </View>
      ) : null}
      {footnote ? <Text style={[styles.deltaText, { color: theme.textTertiary }]}>{footnote}</Text> : null}
    </View>
  );
}

function formatDelta(n: number) {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  title: { fontSize: 17, fontWeight: '800' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.sm },
  toggleText: { fontSize: 13, fontWeight: '600' },
  tr: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 6 },
  th: { flex: 1, minWidth: 90, fontSize: 12, fontWeight: '700', paddingRight: space.sm },
  td: { flex: 1, minWidth: 90, fontSize: 14, paddingRight: space.sm, fontVariant: ['tabular-nums'] },
  num: { textAlign: 'right' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyBlock: { width: 10, height: 10, borderRadius: 2 },
  keyLine: { width: 14, height: 2, borderRadius: 1 },
  legendText: { fontSize: 13 },
  tile: { gap: 4, padding: space.lg, borderWidth: 1, borderRadius: radius.md, flexGrow: 1 },
  tileLabel: { fontSize: 13, fontWeight: '600' },
  tileValue: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  tileUnit: { fontSize: 15, fontWeight: '600' },
  delta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  deltaText: { fontSize: 12, fontWeight: '600' },
});
