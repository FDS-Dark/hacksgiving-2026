/**
 * The general 911-call picture under the safety map: totals, calls per hour,
 * category / district / call-type breakdowns, and the latest calls. All of it
 * comes from GET /v1/safety/calls (the API ingests MPD's page every five minutes).
 *
 * Charts follow one rule set: thin bars with 4px rounded ends, values in text
 * ink, a single hue for magnitude (districts, hours) and the map's fixed
 * category colors only where the bar stands for a category.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Button, Group, Notice, Row, Txt, tap } from '@/components/ui';
import {
  CALL_DELAY_NOTE,
  CALL_WINDOWS,
  callCategory,
  type CallCategory,
  type CallFeed,
  type CallWindow,
} from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

function minutesAgo(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 1 ? 'just now' : minutes === 1 ? '1 min ago' : `${minutes} min ago`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <Txt variant="caption" tone="secondary">{label}</Txt>
      <Txt variant="title" style={styles.statValue}>{value}</Txt>
      {hint ? <Txt variant="caption" tone="tertiary">{hint}</Txt> : null}
    </View>
  );
}

function Bar({ label, count, max, color, dot, selected, onPress }: {
  label: string;
  count: number;
  max: number;
  color: string;
  dot?: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const width = max ? Math.max(2, (count / max) * 100) : 0;
  const body = (
    <View style={[styles.barRow, selected && { backgroundColor: theme.fill }]}>
      <View style={styles.barLabel}>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        <Txt variant="footnote" numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Txt>
      </View>
      <View style={[styles.barTrack, { backgroundColor: theme.fill }]}>
        {count ? <View style={[styles.barFill, { width: `${width}%`, backgroundColor: color }]} /> : null}
      </View>
      <Txt variant="footnote" tone="secondary" style={styles.barValue}>{count}</Txt>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => { tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}: ${count} calls. ${selected ? 'Showing only these on the map; tap to show all.' : 'Tap to show only these on the map.'}`}
    >
      {body}
    </Pressable>
  );
}

function HourStrip({ hours }: { hours: CallFeed['summary']['by_hour'] }) {
  const theme = useTheme();
  const max = Math.max(1, ...hours.map((h) => h.count));
  const peak = hours.reduce((best, h) => (h.count > best.count ? h : best), hours[0] ?? { label: '', count: 0 });
  // At 24 columns label every sixth hour; fewer columns get every label.
  const every = hours.length > 12 ? 6 : hours.length > 6 ? 2 : 1;
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.hourBars} accessibilityRole="image" accessibilityLabel={
        `Calls per hour: ${hours.map((h) => `${h.label} ${h.count}`).join(', ')}`
      }>
        {hours.map((h, i) => (
          <View key={`${h.label}-${i}`} style={styles.hourColumn}>
            <View style={[styles.hourFill, {
              height: `${Math.max(h.count ? 4 : 0, (h.count / max) * 100)}%`,
              backgroundColor: theme.accent,
            }]} />
          </View>
        ))}
      </View>
      <View style={styles.hourLabels}>
        {hours.map((h, i) => (
          <Txt key={`${h.label}-${i}`} variant="caption" tone="tertiary" style={styles.hourLabel} numberOfLines={1}>
            {i % every === 0 || i === hours.length - 1 ? h.label.replace(' ', '') : ''}
          </Txt>
        ))}
      </View>
      {peak?.count ? (
        <Txt variant="footnote" tone="secondary">Busiest hour: {peak.label} ({peak.count} calls)</Txt>
      ) : null}
    </View>
  );
}

export function CallSummary({
  feed,
  window,
  onWindowChange,
  selectedCategory,
  onSelectCategory,
  loading,
  error,
}: {
  feed?: CallFeed;
  window: CallWindow;
  onWindowChange: (value: CallWindow) => void;
  selectedCategory: CallCategory | null;
  onSelectCategory: (value: CallCategory | null) => void;
  loading?: boolean;
  error?: boolean;
}) {
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const summary = feed?.summary;
  const calls = (feed?.calls ?? []).filter((c) => !selectedCategory || c.category === selectedCategory);
  const serious = summary?.by_category
    .filter((c) => c.label === 'weapons' || c.label === 'violent')
    .reduce((sum, c) => sum + c.count, 0) ?? 0;
  const maxCategory = Math.max(0, ...(summary?.by_category.map((c) => c.count) ?? []));
  const districts = summary?.by_district.filter((d) => d.count > 0 || /^\d$/.test(d.label)) ?? [];
  const maxDistrict = Math.max(0, ...districts.map((d) => d.count));
  const updated = minutesAgo(feed?.lastUpdatedAt ?? null);
  const windowLabel = CALL_WINDOWS.find((w) => w.value === window)?.label ?? `${window} hours`;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.heading}>
        <Txt variant="section">911 calls</Txt>
        <Txt variant="footnote" tone="secondary">{updated ? `MPD · updated ${updated}` : loading ? 'Loading' : ''}</Txt>
      </View>
      <View style={[styles.delay, { backgroundColor: theme.warningSoft }]}>
        <Ionicons name="time-outline" size={16} color={theme.soon} />
        <Txt variant="footnote" style={{ flex: 1 }}>
          Not live: {CALL_DELAY_NOTE}. The app checks for new calls every 30 seconds.
        </Txt>
      </View>
      <Segmented options={CALL_WINDOWS} value={window} onChange={onWindowChange} label="Time window" />

      {error ? (
        <Notice icon="cloud-offline-outline" tone="warning">
          911 call data is unavailable right now. Pull down to retry.
        </Notice>
      ) : feed?.stale ? (
        <Notice icon="time-outline" tone="warning">
          The city feed hasn&apos;t updated recently{updated ? ` (last read ${updated})` : ''}. Calls shown may be out of date.
        </Notice>
      ) : null}

      {summary ? (
        <>
          <View style={styles.stats}>
            <Stat label="Calls" value={String(summary.total)} hint={`last ${windowLabel}`} />
            <Stat label="On the map" value={String(summary.mapped)} hint="approximate location" />
            <Stat label="Weapons / violence" value={String(serious)} hint="unconfirmed" />
          </View>

          {summary.total ? (
            <>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
                <Txt variant="headline">Calls per hour</Txt>
                <HourStrip hours={summary.by_hour} />
              </View>

              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
                <View style={styles.heading}>
                  <Txt variant="headline">By type</Txt>
                  {selectedCategory ? (
                    <Pressable onPress={() => onSelectCategory(null)} accessibilityRole="button" hitSlop={8}>
                      <Txt variant="footnote" color={theme.accent}>Show all</Txt>
                    </Pressable>
                  ) : (
                    <Txt variant="caption" tone="tertiary">Tap to filter the map</Txt>
                  )}
                </View>
                {summary.by_category.map((c) => {
                  const category = callCategory(c.label);
                  return (
                    <Bar
                      key={c.label}
                      label={category.label}
                      count={c.count}
                      max={maxCategory}
                      color={category.color}
                      dot={category.color}
                      selected={selectedCategory === category.id}
                      onPress={() => onSelectCategory(selectedCategory === category.id ? null : category.id)}
                    />
                  );
                })}
              </View>

              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
                <Txt variant="headline">By police district</Txt>
                {districts.map((d) => (
                  <Bar
                    key={d.label}
                    label={/^\d$/.test(d.label) ? `District ${d.label}` : d.label === 'CITY' ? 'Citywide units' : d.label}
                    count={d.count}
                    max={maxDistrict}
                    color={theme.accent}
                  />
                ))}
              </View>

              <Group header="Most common call types">
                {summary.by_nature.slice(0, 6).map((n) => (
                  <Row key={n.label} title={n.label} detail={String(n.count)} />
                ))}
              </Group>

              <Group
                header={selectedCategory ? `Latest ${callCategory(selectedCategory).label.toLowerCase()} calls` : 'Latest calls'}
                footer="Calls are delayed 30–90 minutes by MPD and are not confirmed crimes. Locations are approximate (about 110 m)."
              >
                {calls.length ? (
                  calls.slice(0, showAll ? 60 : 10).map((call) => {
                    const category = callCategory(call.category);
                    return (
                      <Row
                        key={call.id}
                        title={call.nature}
                        subtitle={call.status ? `${call.occurredAt} · ${call.status}` : call.occurredAt}
                        detail={/^\d$/.test(call.district) ? `D${call.district}` : call.district}
                        tile={{ icon: 'phone-alert', color: category.color }}
                      />
                    );
                  })
                ) : (
                  <Row title="No calls of this type in this window" />
                )}
              </Group>
              {calls.length > 10 ? (
                <Button
                  label={showAll ? 'Show fewer' : `Show more (${Math.min(calls.length, 60)} of ${calls.length})`}
                  variant="tinted"
                  onPress={() => setShowAll((v) => !v)}
                />
              ) : null}
            </>
          ) : (
            <Txt variant="subhead" tone="secondary">No calls recorded in the last {windowLabel}.</Txt>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  delay: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, gap: 2, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  statValue: { fontVariant: ['tabular-nums'] },
  card: { gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4, paddingHorizontal: 4, borderRadius: radius.sm },
  barLabel: { width: 128, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { width: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  hourBars: { height: 72, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  hourColumn: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  hourFill: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  hourLabels: { flexDirection: 'row', gap: 2 },
  hourLabel: { flex: 1, textAlign: 'left', fontSize: 9 },
});
