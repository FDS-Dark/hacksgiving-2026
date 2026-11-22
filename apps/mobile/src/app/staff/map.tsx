import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CallSummary } from '@/components/CallSummary';
import { EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { PinMap, hasLocation } from '@/components/PinMap';
import { SafetyMap } from '@/components/SafetyMap';
import { Segmented } from '@/components/Segmented';
import { CaseLine } from '@/components/staff/CaseLine';
import { PageTitle, priorityColor } from '@/components/staff/kit';
import { useCases } from '@/services/cases';
import { type CallCategory, type CallWindow, useCallFeed } from '@/services/recentCalls';
import { space, type, useTheme } from '@/theme/tokens';

type Layer = 'cases' | 'calls';
const LAYERS = [
  { value: 'cases', label: 'Cases' },
  { value: 'calls', label: '911 calls' },
] as const;

/**
 * Figma S2 "Map": open cases with a location (tap a pin for its card; the card
 * opens the case), and recent MPD 911 calls with their summary.
 * Opens on 911 calls when there are no cases to map.
 */
export default function StaffMapScreen() {
  const theme = useTheme();
  const open = useCases({ open_only: true, limit: 500 });
  const [layer, setLayer] = useState<Layer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [callWindow, setCallWindow] = useState<CallWindow>('6');
  const [callCategory, setCallCategory] = useState<CallCategory | null>(null);
  const calls = useCallFeed(Number(callWindow));

  // Built once per data change: a new array would reload the map's page.
  const pinned = useMemo(() => (open.data ?? []).filter(hasLocation), [open.data]);
  const pins = useMemo(
    () => pinned.map((c) => ({ id: c.id, latitude: c.latitude, longitude: c.longitude, label: `#${c.number}`, color: priorityColor(theme, c.priority) })),
    [pinned, theme],
  );
  const mapCalls = useMemo(
    () => (calls.data?.calls ?? []).filter((call) => !callCategory || call.category === callCategory),
    [calls.data, callCategory],
  );
  const noPoints = useMemo(() => [], []);

  const shown: Layer = layer ?? (open.isPending || pinned.length ? 'cases' : 'calls');
  const selected = pinned.find((c) => c.id === selectedId) ?? null;
  const unpinned = (open.data?.length ?? 0) - pinned.length;

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          refreshing={open.isRefetching || calls.isRefetching}
          onRefresh={() => {
            open.refetch();
            calls.refetch();
          }}
        />
      }
    >
      <PageTitle
        title="Map"
        subtitle={
          shown === 'cases'
            ? `${pinned.length} open case${pinned.length === 1 ? '' : 's'} on the map`
            : `${calls.data?.summary.mapped ?? 0} recent 911 calls on the map`
        }
      />
      <Segmented options={LAYERS} value={shown} onChange={setLayer} label="Map layer" />

      {shown === 'cases' ? (
        open.isPending ? (
          <Loading label="Loading open cases" />
        ) : !open.data ? (
          <ErrorBanner error={open.error} onRetry={() => open.refetch()} />
        ) : (
          <>
            {pinned.length ? (
              <View style={styles.caseMap}>
                <PinMap pins={pins} onSelect={setSelectedId} />
              </View>
            ) : (
              <EmptyState icon="map-outline" title="Nothing to map yet" body="Open cases with a location show up here." />
            )}
            {selected ? <CaseLine item={selected} /> : null}
            {unpinned ? (
              <Text style={[type.footnote, { color: theme.textSecondary }]}>
                {unpinned} open case{unpinned === 1 ? ' has' : 's have'} no location. Find {unpinned === 1 ? 'it' : 'them'} in Queue.
              </Text>
            ) : null}
          </>
        )
      ) : (
        <>
          <SafetyMap points={noPoints} recentCalls={mapCalls} callsOnly />
          <CallSummary
            feed={calls.data}
            window={callWindow}
            onWindowChange={setCallWindow}
            selectedCategory={callCategory}
            onSelectCategory={setCallCategory}
            loading={calls.isPending}
            error={calls.isError}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, width: '100%', maxWidth: 900, alignSelf: 'center', paddingBottom: space.xxl },
  // In a scroll view the map can't flex to fill the screen; give it the safety map's height.
  caseMap: { height: 480 },
});
