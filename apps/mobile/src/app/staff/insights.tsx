import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CASE_STATUSES } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ErrorBanner, Loading } from '@/components/ui';
import { BarList, Card, CardTitle, PageTitle, StatTile, statusColor } from '@/components/staff/kit';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { dateTime, hours } from '@/lib/format';
import { useInsights } from '@/services/cases';
import { sourceLabel, useCrimeTrends, useSourceHealth, yearOverYear } from '@/services/publicData';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Figma "D2 Admin · Insights", from the live case tables. The mockup's
 * date/district filters and "Pattern spotted" card wait on data we don't
 * have yet (locations by district, AI over debriefs in step 3).
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const insights = useInsights();
  const trends = useCrimeTrends();
  const sources = useSourceHealth();

  if (insights.isPending) return <Loading label="Loading insights" />;
  if (insights.error) {
    return (
      <Page>
        <ErrorBanner error={insights.error} onRetry={() => insights.refetch()} />
      </Page>
    );
  }
  const { stats, by_category, by_status, recent_activity } = insights.data;
  const comparison = yearOverYear(trends.data ?? []);

  const byNeed = [...by_category]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], value: c.total, color: theme.accent, detail: c.active ? `${c.active} open` : undefined }));

  const statusCounts = new Map(by_status.map((s) => [s.status, s.total]));
  const byStatus = CASE_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], value: statusCounts.get(s) ?? 0, color: statusColor(theme, s) })).filter((s) => s.value > 0);

  return (
    <Page
      refreshing={insights.isRefetching || trends.isRefetching || sources.isRefetching}
      onRefresh={() => { insights.refetch(); trends.refetch(); sources.refetch(); }}
      contentStyle={{ maxWidth: 720, gap: space.md }}
    >
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

      <Card style={{ gap: space.md }}>
        <CardTitle title="Requests by need" />
        <BarList items={byNeed} empty="No cases yet." />
      </Card>

      <Card style={{ gap: space.md }}>
        <CardTitle title="Where cases stand" />
        <BarList items={byStatus} empty="No cases yet." />
      </Card>

      <Card style={{ gap: space.sm }}>
        <CardTitle title="Milwaukee violent-crime trend" icon="trending-up-outline" />
        {comparison ? (
          <>
            <View style={styles.trendRow}>
              <Text style={[styles.trendValue, { color: comparison.percentChange != null && comparison.percentChange <= 0 ? theme.accent : theme.danger }]}>
                {comparison.percentChange == null ? '—' : `${comparison.percentChange > 0 ? '+' : ''}${comparison.percentChange.toFixed(1)}%`}
              </Text>
              <Text style={[type.subhead, { color: theme.textSecondary, flex: 1 }]}>latest 12 months vs. the preceding 12 months</Text>
            </View>
            <Text style={[type.footnote, { color: theme.textSecondary }]}>
              {comparison.current.toLocaleString()} reported offenses vs. {comparison.previous.toLocaleString()} previously · through {new Date(`${comparison.latestMonth}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
            </Text>
          </>
        ) : (
          <Text style={[type.subhead, { color: theme.textSecondary }]}>Two complete years of FBI Crime Data Explorer results are needed before a fair comparison is shown.</Text>
        )}
        <Text style={[type.caption, { color: theme.textSecondary }]}>Reported offenses can be revised and do not predict future safety. Source: FBI Crime Data Explorer.</Text>
      </Card>

      <Card style={{ gap: space.sm }}>
        <CardTitle title="Data freshness" icon="cloud-done-outline" />
        {sources.data?.length ? sources.data.map((source) => {
          const isCurrent = source.status === 'ok';
          const successfulAt = source.last_success_at ?? (isCurrent ? source.finished_at : null);
          return (
            <View key={`${source.source}-${source.target}`} style={[styles.sourceRow, { borderTopColor: theme.separator }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>{sourceLabel(source.source)}</Text>
                <Text style={[type.caption, { color: theme.textSecondary }]}>{successfulAt ? `Last successful update ${dateTime(successfulAt)}` : 'No successful update recorded yet'}</Text>
              </View>
              <Text style={[type.caption, { color: isCurrent ? theme.accent : theme.soon, fontWeight: '700' }]}>
                {isCurrent ? 'Current' : source.status.replaceAll('_', ' ')}
              </Text>
            </View>
          );
        }) : (
          <Text style={[type.subhead, { color: theme.textSecondary }]}>Source status is unavailable right now.</Text>
        )}
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

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10 },
  activity: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  trendRow: { flexDirection: 'row', gap: space.md, alignItems: 'baseline' },
  trendValue: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  sourceRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
});
