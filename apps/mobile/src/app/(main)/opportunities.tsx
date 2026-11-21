import Ionicons from '@expo/vector-icons/Ionicons';
import { useDeferredValue, useState } from 'react';
import { StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { OPPORTUNITY_KINDS, type OpportunityKind } from '@/api/types';
import { KIND_INFO, OpportunityCard } from '@/components/OpportunityCard';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Chip, Chips, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { useOpportunities } from '@/services/opportunities';
import { radius, space, useTheme } from '@/theme/tokens';

/** Residents search the volunteer and job opportunities ComForce has posted. */
export default function OpportunitiesScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<OpportunityKind | null>(null);
  // Search as they type; deferring keeps typing smooth while results load.
  const search = useDeferredValue(q);
  const list = useOpportunities({ q: search, kind });
  const columns = width >= 900 ? 2 : 1;

  return (
    <Page refreshing={list.isRefetching} onRefresh={() => list.refetch()} contentStyle={{ gap: space.lg }}>
      <SectionHeading title="Opportunities" kicker="Jobs and volunteer work posted by ComForce MKE and our partners." />

      <View style={[styles.search, { backgroundColor: theme.fill }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by title, organization or neighborhood"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          style={[styles.searchInput, { color: theme.text }]}
          accessibilityLabel="Search opportunities"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <Chips>
        <Chip label="All" active={kind === null} onPress={() => setKind(null)} />
        {OPPORTUNITY_KINDS.map((k) => (
          <Chip key={k} label={k === 'job' ? 'Jobs' : 'Volunteer'} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </Chips>

      {list.isPending ? (
        <Loading label="Loading opportunities" />
      ) : list.isError ? (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={kind ? KIND_INFO[kind].icon : 'search-outline'}
          title="Nothing found"
          body={q.trim() || kind ? 'Try a different search or filter.' : 'No opportunities are posted right now. Check back soon.'}
        />
      ) : (
        <View style={styles.grid}>
          {list.data.map((o) => (
            <View key={o.id} style={{ width: `${100 / columns}%`, padding: space.sm }}>
              <OpportunityCard item={o} />
            </View>
          ))}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm },
});
