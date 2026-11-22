import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CASE_STATUSES } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ErrorBanner, Loading } from '@/components/ui';
import { BarList, Card, CardTitle, PageTitle, StatTile, statusColor } from '@/components/staff/kit';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { dateTime, hours } from '@/lib/format';
import { addDays, startOfDay } from '@/lib/oncall';
import { responseTime } from '@/lib/urgent';
import { useInsights } from '@/services/cases';
import { useOncallStats } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Figma "D2 Admin · Insights", from the live case tables. The mockup's
 * date/district filters and "Pattern spotted" card wait on data we don't
 * have yet (locations by district, AI over debriefs in step 3).
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const insights = useInsights();
  const isAdmin = !!useStaffStatus().data?.is_admin;

  if (insights.isPending) return <Loading label="Loading insights" />;
  if (insights.error) {
    return (
      <Page>
        <ErrorBanner error={insights.error} onRetry={() => insights.refetch()} />
      </Page>
    );
  }
  const { stats, by_category, by_status, recent_activity } = insights.data;

  const byNeed = [...by_category]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], value: c.total, color: theme.accent, detail: c.active ? `${c.active} open` : undefined }));

  const statusCounts = new Map(by_status.map((s) => [s.status, s.total]));
  const byStatus = CASE_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], value: statusCounts.get(s) ?? 0, color: statusColor(theme, s) })).filter((s) => s.value > 0);

  return (
    <Page refreshing={insights.isRefetching} onRefresh={() => insights.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink label="Me" fallback="/staff/me" />
      <PageTitle title="Insights" subtitle={`All time · ${stats.total} case${stats.total === 1 ? '' : 's'}`} />

      <View style={{ gap: 10 }}>
        <View style={styles.tiles}>
          <StatTile label="Avg time to resolve" value={hours(stats.avg_resolution_hours)} color={theme.accent} />
          <StatTile label="Cases resolved" value={stats.resolved} />
        </View>
        <View style={styles.tiles}>
          <StatTile label="Opened this week" value={stats.opened_last_7_days} />
          <StatTile label="Resolved this week" value={stats.resolved_last_7_days} color={theme.accent} />
        </View>
      </View>

      {isAdmin ? <OncallResponse /> : null}

      <Card style={{ gap: space.md }}>
        <CardTitle title="Requests by need" />
        <BarList items={byNeed} empty="No cases yet." />
      </Card>

      <Card style={{ gap: space.md }}>
        <CardTitle title="Where cases stand" />
        <BarList items={byStatus} empty="No cases yet." />
      </Card>

      {recent_activity.length ? (
        <Card style={{ gap: space.sm }}>
          <CardTitle title="Recent activity" />
          {recent_activity.slice(0, 8).map((u) => (
            <Text
              key={u.id}
              onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: u.case_id } })}
              accessibilityRole="link"
              style={[type.footnote, styles.activity, { color: theme.text, borderTopColor: theme.separator }]}
              numberOfLines={2}
            >
              <Text style={{ fontWeight: '700' }}>#{u.case_number}</Text> {u.content}
              <Text style={{ color: theme.textSecondary }}>
                {' '}
                · {u.author_name ?? 'System'} · {dateTime(u.created_at)}
              </Text>
            </Text>
          ))}
        </Card>
      ) : null}
    </Page>
  );
}

/**
 * Urgent alerts over the last 30 days (admins: GET /oncall/stats): how long
 * until someone accepts, and how many were accepted or went unanswered.
 * Its own query, so a failure here never hides the rest of the page.
 */
function OncallResponse() {
  const theme = useTheme();
  // Whole days, fixed for the screen's life, so the query key stays put.
  const [range] = useState(() => {
    const to = addDays(startOfDay(new Date()), 1);
    return { from: addDays(to, -30).toISOString(), to: to.toISOString() };
  });
  const stats = useOncallStats(range.from, range.to);

  return (
    <Card style={{ gap: space.md }}>
      <CardTitle title="Urgent response" icon="warning-outline" right={<Text style={[type.caption, { color: theme.textSecondary }]}>Last 30 days</Text>} />
      {stats.data ? (
        <View style={styles.tiles}>
          <StatTile label="Average response" value={responseTime(stats.data.avg_seconds_to_accept)} color={theme.accent} />
          <StatTile label="Accepted" value={stats.data.accepted} />
          <StatTile label="Unanswered" value={stats.data.unanswered} color={stats.data.unanswered ? theme.danger : undefined} />
        </View>
      ) : stats.error ? (
        <ErrorBanner error={stats.error} onRetry={() => stats.refetch()} />
      ) : (
        <Loading />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10 },
  activity: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
});
