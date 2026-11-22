import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory, type Resource } from '@/api/types';
import { Page } from '@/components/Page';
import { PinMap, hasLocation } from '@/components/PinMap';
import { Card, SampleTag, ResidentHeader } from '@/components/resident';
import { RefreshError } from '@/components/RefreshError';
import { CaseListSkeleton } from '@/components/Skeleton';
import { Chip, Chips, EmptyState, ErrorBanner, Field } from '@/components/ui';
import { bedsLabel } from '@/lib/beds';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/cases';
import { useResources } from '@/services/resources';
import { space, useTheme } from '@/theme/tokens';

function isCategory(value: string | undefined): value is CaseCategory {
  return !!value && (CASE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Figma R3 "Nearby": a map of the places and programs ComForce works with,
 * then the list by kind of help. Tap a pin or a row for the place. The
 * public safety map is one tap away.
 */
export default function NearbyTab() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<CaseCategory | null>(isCategory(params.category) ? params.category : null);
  const [query, setQuery] = useState('');
  const resources = useResources();

  const all = useMemo(() => resources.data ?? [], [resources.data]);
  const present = CASE_CATEGORIES.filter((c) => all.some((r) => r.category === c));
  const q = query.trim().toLowerCase();
  // Searched here, not by the API, so typing never blanks the list while it loads.
  const shown = useMemo(
    () =>
      all.filter(
        (r) =>
          (!category || r.category === category) &&
          (!q || [r.name, r.description, r.neighborhood, r.address].some((text) => text?.toLowerCase().includes(q))),
      ),
    [all, category, q],
  );
  // A new pin array would reload the map's page, so only rebuild it when the places change.
  const pins = useMemo(
    () => shown.filter(hasLocation).map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, label: r.name, color: theme.accent })),
    [shown, theme.accent],
  );

  return (
    <Page refreshing={resources.isRefetching} onRefresh={() => resources.refetch()} contentStyle={{ maxWidth: 560, gap: space.md }}>
      <ResidentHeader title="Nearby" />

      {pins.length ? (
        <View style={styles.map}>
          <PinMap pins={pins} onSelect={(id) => router.push({ pathname: '/place/[id]', params: { id } })} />
        </View>
      ) : null}

      <Pressable
        onPress={() => router.push('/safety')}
        accessibilityRole="button"
        accessibilityLabel="Neighborhood awareness"
        style={({ pressed }) => pressed && { opacity: 0.8 }}
      >
        <Card style={styles.row}>
          <Ionicons name="map-outline" size={22} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: theme.text }]}>Neighborhood awareness</Text>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>Public incident and dispatch activity near you</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
        </Card>
      </Pressable>

      <Field icon="search" placeholder="Search places and programs" value={query} onChangeText={setQuery} autoCorrect={false} accessibilityLabel="Search places" />

      <Chips scroll>
        <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
        {present.map((c) => (
          <Chip key={c} label={CATEGORY_LABEL[c]} active={category === c} onPress={() => setCategory(category === c ? null : c)} />
        ))}
      </Chips>

      <RefreshError query={resources} what="places" />
      {resources.isPending ? (
        <CaseListSkeleton rows={4} />
      ) : !resources.data ? (
        <ErrorBanner error={resources.error} onRetry={() => resources.refetch()} />
      ) : shown.length ? (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {shown.map((r, i) => (
            <PlaceRow key={r.id} place={r} first={i === 0} />
          ))}
        </View>
      ) : (
        <EmptyState icon="location-outline" title="Nothing here yet" body={query ? 'Try a different search.' : 'ComForce is still adding places for this kind of help.'} />
      )}
    </Page>
  );
}

function PlaceRow({ place: r, first }: { place: Resource; first: boolean }) {
  const theme = useTheme();
  const meta = [CATEGORY_LABEL[r.category], r.neighborhood, r.hours].filter(Boolean).join(' · ');
  const beds = bedsLabel(r);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/place/[id]', params: { id: r.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}. ${meta}${beds ? `. ${beds}` : ''}`}
      style={({ pressed }) => [styles.place, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.icon, { backgroundColor: theme.fill }]}>
        <Ionicons name={CATEGORY_ICON[r.category]} size={20} color={theme.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.row}>
          <Text style={[styles.name, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
            {r.name}
          </Text>
          {r.is_sample ? <SampleTag /> : null}
        </View>
        <Text style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={2}>
          {meta}
        </Text>
        {beds ? <Text style={[styles.meta, { color: r.beds_available ? theme.accent : theme.textSecondary, fontWeight: '700' }]}>{beds}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: { height: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  list: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
});
