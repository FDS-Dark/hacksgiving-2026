import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { OpportunityOrigin } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { OpportunityCard } from '@/components/OpportunityCard';
import { Page } from '@/components/Page';
import { PageTitle } from '@/components/staff/kit';
import { Button, Chip, Chips, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { useOpportunities, useSetOpportunityActive } from '@/services/opportunities';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Manage jobs and programs: what's posted comes first, with Close and
 * Reopen; "Post a job or program" opens the form on its own screen
 * (cognitive-load review, top 10 #10: the form used to sit above the list,
 * 31 controls before anything posted). Opened from Me; the staff layout
 * already gates it to workers.
 */
export default function ManageOpportunitiesScreen() {
  const theme = useTheme();
  // Staff postings by default; the imports can run to hundreds.
  const [origin, setOrigin] = useState<OpportunityOrigin>('manual');
  const list = useOpportunities({ includeClosed: true, origin });
  const toggle = useSetOpportunityActive();
  const open = list.data?.filter((o) => o.active).length;

  return (
    <Page refreshing={list.isRefetching} onRefresh={() => list.refetch()} contentStyle={{ gap: space.lg, maxWidth: 900 }}>
      <BackLink to="/staff/me" label="Me" />
      <PageTitle title="Manage jobs and programs" subtitle="Residents find these in the app, before job-board listings." />
      <Button label="Post a job or program" icon="add-circle-outline" size="lg" onPress={() => router.push('/staff/opportunities/new')} />

      <View style={{ gap: space.md }}>
        <Text accessibilityRole="header" style={[type.headline, { color: theme.text }]}>
          Posted{open === undefined ? '' : ` · ${open} open`}
        </Text>
        <Chips>
          <Chip label="By staff" active={origin === 'manual'} onPress={() => setOrigin('manual')} />
          <Chip label="From job boards" active={origin === 'imported'} onPress={() => setOrigin('imported')} />
        </Chips>
        {origin === 'imported' ? (
          <Text style={[type.footnote, { color: theme.textSecondary }]}>Added every night. Closing one keeps it closed, even if the job board still lists it.</Text>
        ) : null}
        {toggle.isError ? <ErrorBanner error={toggle.error} /> : null}
        {list.isPending ? (
          <Loading label="Loading jobs and programs" />
        ) : list.isError ? (
          <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.length === 0 ? (
          <EmptyState
            icon="briefcase-outline"
            title={origin === 'manual' ? 'Nothing posted yet' : 'Nothing added yet'}
            body={origin === 'manual' ? 'Jobs and programs you post show up here and in the resident app.' : 'Job-board listings show up here after the nightly update.'}
          />
        ) : (
          list.data.map((o) => (
            <OpportunityCard
              key={o.id}
              item={o}
              manage
              footer={
                <Button
                  label={o.active ? 'Close posting' : 'Reopen posting'}
                  icon={o.active ? 'eye-off-outline' : 'eye-outline'}
                  variant={o.active ? 'destructive' : 'tinted'}
                  loading={toggle.isPending && toggle.variables?.id === o.id}
                  onPress={() => toggle.mutate({ id: o.id, active: !o.active })}
                />
              }
            />
          ))
        )}
      </View>
    </Page>
  );
}

