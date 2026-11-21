import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { PinMap, hasLocation } from '@/components/PinMap';
import { CaseLine } from '@/components/staff/CaseLine';
import { PageTitle, priorityColor } from '@/components/staff/kit';
import { useCases } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** Figma S2 "Map": open cases with a location. Tap a pin for its card; the card opens the case. */
export default function StaffMapScreen() {
  const theme = useTheme();
  const open = useCases({ open_only: true, limit: 500 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Built once per data change: a new array would reload the map's page.
  const pinned = useMemo(() => (open.data ?? []).filter(hasLocation), [open.data]);
  const pins = useMemo(
    () => pinned.map((c) => ({ id: c.id, latitude: c.latitude, longitude: c.longitude, label: `#${c.number}`, color: priorityColor(theme, c.priority) })),
    [pinned, theme],
  );

  if (open.isPending) return <Loading label="Loading open cases" />;
  if (!open.data) {
    return (
      <View style={styles.page}>
        <ErrorBanner error={open.error} onRetry={() => open.refetch()} />
      </View>
    );
  }

  const selected = pinned.find((c) => c.id === selectedId) ?? null;
  const unpinned = open.data.length - pinned.length;

  return (
    <View style={styles.page}>
      <PageTitle title="Map" subtitle={`${pinned.length} open case${pinned.length === 1 ? '' : 's'} on the map`} />
      {pinned.length ? (
        <PinMap pins={pins} onSelect={setSelectedId} />
      ) : (
        <EmptyState icon="map-outline" title="Nothing to map yet" body="Open cases with a location show up here." />
      )}
      {selected ? <CaseLine item={selected} /> : null}
      {unpinned ? (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>
          {unpinned} open case{unpinned === 1 ? ' has' : 's have'} no location and only show in the queue.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: space.lg, gap: space.md, width: '100%', maxWidth: 900, alignSelf: 'center' },
});
