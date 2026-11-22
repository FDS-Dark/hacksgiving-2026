import Ionicons from '@expo/vector-icons/Ionicons';
import { useDeferredValue, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { OPPORTUNITY_KINDS, type OpportunityKind } from '@/api/types';
import { AUDIENCE_INFO, KIND_INFO, OpportunityCard } from '@/components/OpportunityCard';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, Chip, Chips, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { useOpportunities } from '@/services/opportunities';
import { radius, space, useTheme } from '@/theme/tokens';

/** USAJOBS, one of the public boards the data loader imports from (api/adapters/usajobs.py), searched near Milwaukee. */
const PUBLIC_JOB_BOARD = 'https://www.usajobs.gov/Search/Results?l=Milwaukee%2C%20Wisconsin';

/** Residents search jobs, education and volunteer work: ComForce's own
 *  postings first, then listings the data loader imports from job boards. */
export default function OpportunitiesScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<OpportunityKind | null>(null);
  const [secondChance, setSecondChance] = useState(false);
  // Search as they type; deferring keeps typing smooth while results load.
  const search = useDeferredValue(q);
  const list = useOpportunities({ q: search, kind, audience: secondChance ? 'second_chance' : null });
  const filtered = Boolean(q.trim() || kind || secondChance);
  const columns = width >= 900 ? 2 : 1;
  const publicBoards = <Button label="Search public job boards" icon="open-outline" variant="plain" onPress={() => Linking.openURL(PUBLIC_JOB_BOARD)} />;

  return (
    <Page
      header={<ResidentHeader title="Jobs and programs" back="/me" />}
      refreshing={list.isRefetching}
      onRefresh={() => list.refetch()}
      contentStyle={{ gap: space.lg }}
    >
      <Text style={{ fontSize: 15, color: theme.textSecondary }}>Jobs and programs you can apply for. ComForce postings come first.</Text>

      <View style={[styles.search, { backgroundColor: theme.fill }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search jobs and programs"
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          style={[styles.searchInput, { color: theme.text }]}
          accessibilityLabel="Search jobs and programs"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <Chips>
        <Chip label="All" active={kind === null} onPress={() => setKind(null)} />
        {OPPORTUNITY_KINDS.map((k) => (
          <Chip key={k} label={KIND_INFO[k].plural} active={kind === k} onPress={() => setKind(k)} />
        ))}
        <Chip label={AUDIENCE_INFO.second_chance.label} active={secondChance} onPress={() => setSecondChance((on) => !on)} />
      </Chips>

      {list.isPending ? (
        <Loading label="Loading jobs and programs" />
      ) : list.isError ? (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={kind ? KIND_INFO[kind].icon : 'search-outline'}
          title={filtered ? 'Nothing matches' : 'Nothing posted right now'}
          body={
            filtered
              ? 'Try fewer filters or other words. You can also search public job boards.'
              : 'ComForce adds jobs and programs often. Until then, search public job boards near Milwaukee.'
          }
          action={
            <View style={{ gap: space.sm, alignItems: 'center' }}>
              {filtered ? (
                <Button
                  label="Clear filters"
                  variant="tinted"
                  onPress={() => {
                    setQ('');
                    setKind(null);
                    setSecondChance(false);
                  }}
                />
              ) : null}
              {publicBoards}
            </View>
          }
        />
      ) : (
        <>
          <View style={styles.grid}>
            {list.data.map((o) => (
              <View key={o.id} style={{ width: `${100 / columns}%`, padding: space.sm }}>
                <OpportunityCard item={o} />
              </View>
            ))}
          </View>
          {publicBoards}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm, minHeight: 44 },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm },
});
