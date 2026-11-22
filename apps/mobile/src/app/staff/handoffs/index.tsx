import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { HandoffBriefView, handoffCounts, handoffTitle } from '@/components/staff/HandoffBriefView';
import { EmptyState, ErrorBanner, Group, Loading, Row } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useHandoffs } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Shift handoffs: the brief written when someone goes off call (the newest
 * shown in full), and earlier ones from the past week.
 */
export default function HandoffsScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const handoffs = useHandoffs();
  const [latest, ...earlier] = handoffs.data ?? [];

  return (
    <Page refreshing={handoffs.isRefetching} onRefresh={() => handoffs.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink to="/staff" label="Today" />
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={{ fontSize: 28, fontWeight: '800', color: theme.text }}>
          Shift handoff
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          Written when someone goes off call, for whoever is on next.
        </Text>
      </View>

      {handoffs.isPending ? (
        <Loading label="Loading handoffs" />
      ) : handoffs.error ? (
        <ErrorBanner error={handoffs.error} onRetry={() => handoffs.refetch()} />
      ) : !latest ? (
        <EmptyState icon="swap-horizontal-outline" title="No handoffs this week" body="When you switch off call, a brief of your open cases and tasks is written here for the next person." />
      ) : (
        <>
          <Row
            title={handoffTitle(latest, me.data?.id)}
            subtitle={`${handoffCounts(latest)} · ${timeAgo(latest.created_at)}`}
            icon="swap-horizontal-outline"
            accessory="chevron"
            onPress={() => router.push({ pathname: '/staff/handoffs/[id]', params: { id: latest.id } })}
          />
          <HandoffBriefView handoff={latest} />
          {earlier.length ? (
            <Group header="Earlier this week">
              {earlier.map((h) => (
                <Row
                  key={h.id}
                  title={handoffTitle(h, me.data?.id)}
                  subtitle={`${handoffCounts(h)} · ${timeAgo(h.created_at)}`}
                  accessory="chevron"
                  onPress={() => router.push({ pathname: '/staff/handoffs/[id]', params: { id: h.id } })}
                />
              ))}
            </Group>
          ) : null}
        </>
      )}
    </Page>
  );
}
