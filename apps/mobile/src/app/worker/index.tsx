import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CASE_STATUSES, type CaseUpdate } from '@/api/types';
import { Page } from '@/components/Page';
import { Button, EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { CaseTable } from '@/components/worker/CaseTable';
import {
  BarList,
  CATEGORY_LABEL,
  Card,
  CardTitle,
  MetricCard,
  PageTitle,
  STATUS_LABEL,
  hours,
  priorityColor,
  statusColor,
  timeAgo,
} from '@/components/worker/kit';
import { useCases, useInsights, useStaffStatus } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** The worker's home: live numbers, the most urgent open cases, and where things stand. */
export default function DashboardScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const me = useStaffStatus();
  const insights = useInsights();
  const urgent = useCases({ open_only: true, limit: 8 });
  const mine = useCases({ open_only: true, assigned_worker_id: me.data?.id, limit: 200 }, !!me.data);

  const refresh = () => {
    insights.refetch();
    urgent.refetch();
    mine.refetch();
  };

  if (insights.isPending) return <Loading label="Loading the dashboard" />;
  if (insights.error) {
    return (
      <Page>
        <ErrorBanner error={insights.error} onRetry={refresh} />
      </Page>
    );
  }

  const { stats, by_category, by_status, recent_activity } = insights.data;
  const queue = (params: Record<string, string>) => router.push({ pathname: '/worker/cases', params });

  return (
    <Page refreshing={insights.isRefetching} onRefresh={refresh} contentStyle={{ gap: space.xl }}>
      <PageTitle
        title="Operations dashboard"
        subtitle={`Counted live from ComForce case records · ${mine.data?.length ?? 0} open case${mine.data?.length === 1 ? '' : 's'} assigned to you`}
        right={<Button label="New case" icon="add" onPress={() => router.push('/worker/cases/new')} />}
      />

      <View style={styles.metrics}>
        <MetricCard label="Active cases" value={stats.active} icon="pulse-outline" color={theme.accent} hint={`${stats.total} total`} onPress={() => queue({ open: '1' })} />
        <MetricCard label="New requests" value={stats.new} icon="mail-unread-outline" color={statusColor(theme, 'new')} hint="Waiting for triage" onPress={() => queue({ status: 'new' })} />
        <MetricCard label="High priority" value={stats.high_priority_active} icon="warning-outline" color={priorityColor(theme, 'critical')} hint="High or critical, still open" onPress={() => queue({ open: '1', urgent: '1' })} />
        <MetricCard label="Awaiting resources" value={stats.awaiting_resources} icon="hourglass-outline" color={statusColor(theme, 'awaiting_resources')} hint="Need a referral to land" onPress={() => queue({ status: 'awaiting_resources' })} />
        <MetricCard label="Unassigned" value={stats.unassigned_active} icon="person-add-outline" color={theme.textSecondary} hint="Open, nobody holds them" onPress={() => queue({ open: '1', assigned: 'unassigned' })} />
        <MetricCard label="Resolved" value={stats.resolved} icon="checkmark-done-outline" color={statusColor(theme, 'resolved')} hint={`${stats.resolved_last_7_days} in the last 7 days`} onPress={() => queue({ status: 'resolved' })} />
      </View>

      {stats.total === 0 ? (
        <Card>
          <EmptyState
            icon="file-tray-outline"
            title="No cases yet"
            body="Requests from the community app (POST /v1/requests) land here as new cases. You can also open one for a call or walk-in."
            action={<Button label="Open a case" icon="add" variant="tinted" onPress={() => router.push('/worker/cases/new')} />}
          />
        </Card>
      ) : (
        <View style={[styles.columns, wide && { flexDirection: 'row' }]}>
          <View style={[styles.column, wide && { flex: 1.6 }]}>
            <Card padded={false} style={{ gap: 0, overflow: 'hidden' }}>
              <View style={{ padding: space.lg }}>
                <CardTitle
                  title="Priority queue"
                  icon="flash-outline"
                  right={<Button label="All cases" variant="plain" onPress={() => router.push('/worker/cases')} />}
                />
                <Text style={[type.footnote, { color: theme.textSecondary }]}>Open cases, most urgent first.</Text>
              </View>
              <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
                {urgent.isPending ? <Loading /> : urgent.error ? <ErrorBanner error={urgent.error} /> : urgent.data.length ? <CaseTable cases={urgent.data} /> : (
                  <EmptyState icon="checkmark-circle-outline" title="Queue clear" body="Every case is resolved or closed." />
                )}
              </View>
            </Card>

            <Card>
              <CardTitle title="Recent activity" icon="time-outline" />
              {recent_activity.length ? recent_activity.map((u) => <ActivityItem key={u.id} update={u} />) : (
                <Text style={[type.subhead, { color: theme.textSecondary }]}>Nothing yet.</Text>
              )}
            </Card>
          </View>

          <View style={[styles.column, wide && { flex: 1 }]}>
            <Card>
              <CardTitle title="Resolution" icon="stopwatch-outline" />
              <View style={styles.pair}>
                <Stat label="Average time to resolve" value={hours(stats.avg_resolution_hours)} />
                <Stat label="Opened, last 7 days" value={String(stats.opened_last_7_days)} />
                <Stat label="Resolved, last 7 days" value={String(stats.resolved_last_7_days)} />
              </View>
            </Card>
            <Card>
              <CardTitle title="Cases by status" icon="stats-chart-outline" />
              <BarList
                empty="No cases yet."
                items={CASE_STATUSES.map((s) => ({
                  key: s,
                  label: STATUS_LABEL[s],
                  value: by_status.find((b) => b.status === s)?.total ?? 0,
                  color: statusColor(theme, s),
                }))}
              />
            </Card>
            <Card>
              <CardTitle title="Cases by category" icon="pie-chart-outline" />
              <BarList
                empty="No cases yet."
                items={by_category.map((c) => ({
                  key: c.category,
                  label: CATEGORY_LABEL[c.category],
                  value: c.total,
                  detail: `${c.active} open`,
                  color: theme.accent,
                }))}
              />
            </Card>
          </View>
        </View>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}>
      <Text style={[type.title, { color: theme.text }]}>{value}</Text>
      <Text style={[type.caption, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const ACTIVITY_ICON: Record<CaseUpdate['update_type'], keyof typeof Ionicons.glyphMap> = {
  created: 'add-circle-outline',
  note: 'document-text-outline',
  message: 'chatbubble-ellipses-outline',
  status_change: 'swap-horizontal-outline',
  priority_change: 'flag-outline',
  category_change: 'pricetag-outline',
  assignment: 'person-outline',
  referral: 'link-outline',
};

export function ActivityItem({ update: u }: { update: CaseUpdate }) {
  const theme = useTheme();
  return (
    <View style={styles.activity}>
      <Ionicons name={ACTIVITY_ICON[u.update_type]} size={18} color={theme.accent} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={[type.subhead, { color: theme.accent, fontWeight: '600' }]}
          onPress={() => router.push({ pathname: '/worker/cases/[id]', params: { id: u.case_id } })}
          accessibilityRole="link"
          numberOfLines={1}
        >
          #{u.case_number} {u.case_title}
        </Text>
        <Text style={[type.footnote, { color: theme.text }]} numberOfLines={2}>
          {u.content}
        </Text>
        <Text style={[type.caption, { color: theme.textSecondary }]}>
          {u.author_name ?? 'System'} · {timeAgo(u.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  columns: { gap: space.xl, alignItems: 'flex-start' },
  column: { gap: space.xl, width: '100%', minWidth: 0 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  activity: { flexDirection: 'row', gap: space.md, paddingVertical: space.xs },
});
