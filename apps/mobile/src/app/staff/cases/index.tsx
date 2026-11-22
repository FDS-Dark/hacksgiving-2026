import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, type CaseCategory } from '@/api/types';
import { Page } from '@/components/Page';
import { RefreshError } from '@/components/RefreshError';
import { ServiceGuide } from '@/components/ServiceGuide';
import { CaseLine } from '@/components/staff/CaseLine';
import { ChoiceRow } from '@/components/staff/kit';
import { CaseListSkeleton } from '@/components/Skeleton';
import { Chip, Chips, EmptyState, ErrorBanner, Field } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import {
  QUEUE_VIEWS,
  QUEUE_VIEW_LABEL,
  RECENT_LABEL,
  inView,
  matchesSearch,
  modeFromParams,
  sortRecentlyWorked,
  viewCounts,
  workedLabel,
  type QueueMode,
} from '@/lib/queue';
import { useCases, useRecentlyWorked } from '@/services/cases';
import { useStaffStatus } from '@/services/staff';
import { space, useTheme } from '@/theme/tokens';

/**
 * Figma S1 "Queue": every case, most urgent first. Chips pick a view (with
 * counts), search covers #number, title, description and place, and the
 * filter button narrows to one type of help and opens its handling guide.
 * "Recently worked" lists the cases I touched last, newest first, each with
 * what I did and when (cognitive-load review S2).
 */
export default function QueueScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ view?: string; status?: string; assigned?: string; urgent?: string; category?: string }>();
  const me = useStaffStatus();
  const [view, setView] = useState<QueueMode>(modeFromParams(params));
  const cases = useCases({ limit: 500 });
  const recent = useRecentlyWorked(view === 'recent');

  const [category, setCategory] = useState<CaseCategory | null>(
    (CASE_CATEGORIES as readonly string[]).includes(params.category ?? '') ? (params.category as CaseCategory) : null,
  );
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filtering, setFiltering] = useState(!!category);

  const myId = me.data?.id;
  const all = useMemo(() => cases.data ?? [], [cases.data]);
  const inCategory = useMemo(() => (category ? all.filter((c) => c.category === category) : all), [all, category]);
  const counts = useMemo(() => viewCounts(inCategory, myId), [inCategory, myId]);
  const isRecent = view === 'recent';
  const shown = isRecent ? [] : inCategory.filter((c) => inView(c, view, myId) && matchesSearch(c, query));
  const recentShown = useMemo(
    () => sortRecentlyWorked(recent.data ?? []).filter((c) => (!category || c.category === category) && matchesSearch(c, query)),
    [recent.data, category, query],
  );
  const active = isRecent ? recent : cases;
  const label = isRecent ? RECENT_LABEL : QUEUE_VIEW_LABEL[view];
  const count = isRecent ? recentShown.length : shown.length;

  return (
    <Page refreshing={active.isRefetching} onRefresh={() => active.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Queue
        </Text>
        <RoundButton icon={searching ? 'close' : 'search'} label={searching ? 'Close search' : 'Search'} onPress={() => {
          setSearching((s) => !s);
          setQuery('');
        }} />
        <RoundButton icon="options-outline" label="Filter by type of help" active={filtering || !!category} onPress={() => setFiltering((f) => !f)} />
        <RoundButton icon="add" label="New case" filled onPress={() => router.push('/staff/cases/new')} />
      </View>

      {searching ? (
        <Field icon="search" placeholder="#number, title or place" value={query} onChangeText={setQuery} autoFocus autoCorrect={false} returnKeyType="search" accessibilityLabel="Search cases" />
      ) : null}

      {filtering ? (
        <ChoiceRow label="Type of help" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={setCategory} allowNone noneLabel="All" />
      ) : null}

      <Chips scroll>
        {QUEUE_VIEWS.map((v) => (
          <Fragment key={v}>
            <Chip label={`${QUEUE_VIEW_LABEL[v]} ${counts[v]}`} active={view === v} onPress={() => setView(v)} />
            {/* Right after Mine: the cases I worked on, whoever holds them now. */}
            {v === 'mine' ? <Chip label={RECENT_LABEL} active={isRecent} onPress={() => setView('recent')} /> : null}
          </Fragment>
        ))}
      </Chips>

      <RefreshError query={active} what={isRecent ? 'your recent cases' : 'the queue'} />

      {/* One type of help picked: its handling guide, collapsed. The key resets it per type. */}
      {category ? <ServiceGuide key={category} category={category} /> : null}

      {active.isPending ? (
        <CaseListSkeleton />
      ) : !active.data ? (
        <ErrorBanner error={active.error} onRetry={() => active.refetch()} />
      ) : count ? (
        <View style={{ gap: space.sm }}>
          {isRecent
            ? recentShown.map((c) => <CaseLine key={c.id} item={c} sub={workedLabel(c)} />)
            : shown.map((c) => <CaseLine key={c.id} item={c} />)}
        </View>
      ) : (
        <EmptyState
          icon={isRecent ? 'time-outline' : 'file-tray-outline'}
          title={query ? 'No cases match' : isRecent ? 'Nothing worked on yet' : `Nothing in ${label}`}
          body={
            query
              ? 'Try a different search.'
              : isRecent
                ? 'Cases you open, update, message or note show up here, newest first.'
                : view === 'open'
                  ? 'New requests from the community will show up here.'
                  : 'Pick another view above.'
          }
        />
      )}
    </Page>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  filled = false,
  active = false,
}: {
  icon: 'search' | 'close' | 'add' | 'options-outline';
  label: string;
  onPress: () => void;
  filled?: boolean;
  active?: boolean;
}) {
  const theme = useTheme();
  const bg = filled ? theme.accent : active ? theme.accentSoft : theme.surface;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.round, { backgroundColor: bg, borderColor: filled ? theme.accent : theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={icon} size={20} color={filled ? theme.onAccent : theme.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, fontSize: 28, fontWeight: '800' },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
