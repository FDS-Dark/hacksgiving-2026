import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory } from '@/api/types';
import { Page } from '@/components/Page';
import { PinMap, hasLocation } from '@/components/PinMap';
import { SampleTag, ResidentHeader } from '@/components/resident';
import { RefreshError } from '@/components/RefreshError';
import { CaseListSkeleton } from '@/components/Skeleton';
import { Button, Chip, Chips, EmptyState, ErrorBanner, Field, Notice, Txt } from '@/components/ui';
import { bedsLabel } from '@/lib/beds';
import { CATEGORY_ICON } from '@/lib/cases';
import {
  FIRST_CATEGORIES,
  OPEN_LABEL,
  PLACE_LABEL,
  countLabel,
  filterPlaces,
  milesLabel,
  rankPlaces,
  type RankedPlace,
} from '@/lib/nearby';
import { useDeviceLocation } from '@/services/deviceLocation';
import { useResources } from '@/services/resources';
import { space, useTheme } from '@/theme/tokens';

/** Places shown at first, and how many more each "Show more" adds. */
const FIRST_PAGE = 4;
const MORE = 10;

function isCategory(value: string | undefined): value is CaseCategory {
  return !!value && (CASE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Figma R3 "Nearby": a short list of places, closest first when the phone
 * shares its location and open today first otherwise, with how many match.
 * Shelter and Food come first; other kinds of help, the map and more wait
 * behind "More filters". Sample listings are labeled and always come last.
 */
export default function NearbyTab() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ category?: string }>();
  const initial = isCategory(params.category) ? params.category : null;
  const [category, setCategory] = useState<CaseCategory | null>(initial);
  const [openTodayOnly, setOpenTodayOnly] = useState(false);
  const [moreOpen, setMoreOpen] = useState(initial !== null && !FIRST_CATEGORIES.includes(initial));
  const [showMap, setShowMap] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(FIRST_PAGE);
  const resources = useResources();
  const device = useDeviceLocation({ auto: true });

  const ranked = useMemo(() => rankPlaces(resources.data ?? [], { from: device.location }), [resources.data, device.location]);
  const shown = useMemo(() => filterPlaces(ranked, { category, query, openTodayOnly }), [ranked, category, query, openTodayOnly]);
  const visible = shown.slice(0, limit);
  const present = CASE_CATEGORIES.filter((c) => ranked.some((r) => r.place.category === c));
  const first = FIRST_CATEGORIES.filter((c) => present.includes(c));
  const others = present.filter((c) => !FIRST_CATEGORIES.includes(c));
  const extraFilters = (category && others.includes(category) ? 1 : 0) + (showMap ? 1 : 0);
  const filtered = Boolean(category || openTodayOnly || query.trim());

  // A new pin array would reload the map's page, so only rebuild it when the places change.
  const pins = useMemo(
    () =>
      showMap
        ? shown.map((r) => r.place).filter(hasLocation).map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, label: r.name, color: theme.accent }))
        : [],
    [showMap, shown, theme.accent],
  );

  const choose = (next: CaseCategory | null) => {
    setCategory(next);
    setLimit(FIRST_PAGE);
  };
  const clear = () => {
    choose(null);
    setOpenTodayOnly(false);
    setQuery('');
  };

  return (
    <Page
      header={<ResidentHeader title="Nearby" />}
      refreshing={resources.isRefetching}
      onRefresh={() => resources.refetch()}
      contentStyle={{ maxWidth: 560, gap: space.md }}
    >
      <Field
        icon="search"
        placeholder="Search places"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setLimit(FIRST_PAGE);
        }}
        autoCorrect={false}
        returnKeyType="search"
      />

      <Chips>
        <Chip
          label="Open today"
          active={openTodayOnly}
          onPress={() => {
            setOpenTodayOnly((on) => !on);
            setLimit(FIRST_PAGE);
          }}
        />
        {first.map((c) => (
          <Chip key={c} label={PLACE_LABEL[c]} active={category === c} onPress={() => choose(category === c ? null : c)} />
        ))}
        <Chip
          label={moreOpen ? 'Fewer filters' : extraFilters ? `More filters (${extraFilters})` : 'More filters'}
          active={moreOpen}
          onPress={() => setMoreOpen((on) => !on)}
        />
      </Chips>

      {moreOpen ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="footnote" tone="secondary">
            Kind of help
          </Txt>
          <Chips>
            {others.map((c) => (
              <Chip key={c} label={PLACE_LABEL[c]} active={category === c} onPress={() => choose(category === c ? null : c)} />
            ))}
          </Chips>
          <Chips>
            <Chip label="Show map" active={showMap} onPress={() => setShowMap((on) => !on)} />
          </Chips>
        </View>
      ) : null}

      <RefreshError query={resources} what="places" />
      {resources.isPending ? (
        <CaseListSkeleton rows={4} />
      ) : !resources.data ? (
        <ErrorBanner error={resources.error} onRetry={() => resources.refetch()} />
      ) : (
        <>
          <View style={styles.status}>
            <Text style={[styles.count, { color: theme.text }]} accessibilityRole="header" accessibilityLiveRegion="polite">
              {countLabel(shown.length, openTodayOnly)}
            </Text>
            {device.location ? (
              <Txt variant="footnote" tone="secondary">
                Closest first
              </Txt>
            ) : device.loading ? (
              <Txt variant="footnote" tone="secondary">
                Finding you…
              </Txt>
            ) : (
              <Button label="Sort by distance" icon="navigate-outline" variant="plain" onPress={device.locate} />
            )}
          </View>
          {device.error ? <Notice icon="location-outline">{device.error}</Notice> : null}

          {showMap && pins.length ? (
            <View style={styles.map}>
              <PinMap pins={pins} onSelect={(id) => router.push({ pathname: '/place/[id]', params: { id } })} />
            </View>
          ) : null}

          {visible.length ? (
            <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
              {visible.map((r, i) => (
                <PlaceRow key={r.place.id} item={r} first={i === 0} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="location-outline"
              title={filtered ? 'No places match' : 'No places yet'}
              body={filtered ? 'Try fewer filters or a different search.' : 'ComForce is still adding places. Ask for help and a worker will find one with you.'}
              action={
                filtered ? (
                  <Button label="Clear filters" variant="tinted" onPress={clear} />
                ) : (
                  <Button label="Get help now" variant="tinted" onPress={() => router.push('/help')} />
                )
              }
            />
          )}

          {shown.length > visible.length ? (
            <Button label={`Show more (${shown.length - visible.length} left)`} variant="tinted" onPress={() => setLimit((n) => n + MORE)} />
          ) : null}
          {openTodayOnly ? (
            <Txt variant="footnote" tone="secondary">
              “Open today” uses the days each place lists. Times can change, so call first if you can.
            </Txt>
          ) : null}
        </>
      )}
    </Page>
  );
}

function PlaceRow({ item: { place: r, open, miles }, first }: { item: RankedPlace; first: boolean }) {
  const theme = useTheme();
  const meta = [PLACE_LABEL[r.category], miles !== null ? milesLabel(miles) : null, OPEN_LABEL[open]].filter(Boolean).join(' · ');
  const beds = bedsLabel(r);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/place/[id]', params: { id: r.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}${r.is_sample ? ', sample listing' : ''}. ${meta}${beds ? `. ${beds}` : ''}`}
      style={({ pressed }) => [styles.place, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.icon, { backgroundColor: theme.fill }]}>
        <Ionicons name={CATEGORY_ICON[r.category]} size={20} color={theme.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.row}>
          <Text style={[styles.name, { color: theme.text, flexShrink: 1 }]} numberOfLines={2}>
            {r.name}
          </Text>
          {r.is_sample ? <SampleTag /> : null}
        </View>
        <Text style={[styles.meta, { color: open === 'yes' ? theme.accent : theme.textSecondary }]} numberOfLines={2}>
          {meta}
        </Text>
        {beds ? (
          <Text style={[styles.meta, { color: r.beds_available ? theme.accent : theme.textSecondary, fontWeight: '700' }]}>{beds}</Text>
        ) : r.hours ? (
          <Text style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={1}>
            {r.hours}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  map: { height: 240 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, minHeight: 44 },
  count: { fontSize: 17, fontWeight: '700' },
  list: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 13, lineHeight: 18 },
});
