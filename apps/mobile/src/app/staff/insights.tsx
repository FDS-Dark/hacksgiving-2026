import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Pattern } from '@/api/types';
import { CASE_STATUSES } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Button, ErrorBanner, Loading, tap } from '@/components/ui';
import { BarList, Card, CardTitle, ChoiceRow, PageTitle, StatTile, statusColor } from '@/components/staff/kit';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { dateTime, hours } from '@/lib/format';
import { addDays, startOfDay } from '@/lib/oncall';
import { responseTime } from '@/lib/urgent';
import { useInsights } from '@/services/cases';
import { sourceLabel, useCrimeTrends, useSourceHealth, yearOverYear } from '@/services/publicData';
import { INSIGHT_PERIODS, type InsightPeriod, useFilteredInsights } from '@/services/insights';
import { useOncallStats } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { useVoiceDashboard } from '@/services/voice';
import { space, type, useTheme } from '@/theme/tokens';

const PERIOD_LABEL: Record<InsightPeriod, string> = { '7': '7 days', '30': '30 days', '90': '90 days' };

/**
 * Figma "D2 Admin · Insights". The period and district filters drive the
 * top half (GET /v1/insights: cases opened in the period, by need, and
 * "Pattern spotted"); where cases stand and recent activity are live, all
 * time (GET /v1/cases/insights). Districts come from where the worker
 * placed each case (api/services/place.py).
 */
export default function InsightsScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<InsightPeriod>('30');
  const [district, setDistrict] = useState<string | null>(null);
  const days = Number(period);
  const filtered = useFilteredInsights(days, district);
  const insights = useInsights();
  const trends = useCrimeTrends();
  const sources = useSourceHealth();
  const isAdmin = !!useStaffStatus().data?.is_admin;

  if (filtered.isPending || insights.isPending) return <Loading label="Loading insights" />;
  const failed = filtered.error ?? insights.error;
  if (failed || !filtered.data || !insights.data) {
    return (
      <Page>
        <ErrorBanner
          error={failed}
          onRetry={() => {
            filtered.refetch();
            insights.refetch();
          }}
        />
      </Page>
    );
  }
  const comparison = yearOverYear(trends.data ?? []);
  const { totals, by_category, patterns, districts } = filtered.data;
  const { by_status, recent_activity } = insights.data;

  const districtKeys = districts.map((d) => d.key);
  const districtLabels = Object.fromEntries(districts.map((d) => [d.key, `District ${d.name}`]));
  const where = district ? districtLabels[district] ?? `District ${district}` : 'All districts';

  const byNeed = [...by_category]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], value: c.total, color: theme.accent, detail: c.active ? `${c.active} open` : undefined }));

  const statusCounts = new Map(by_status.map((s) => [s.status, s.total]));
  const byStatus = CASE_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], value: statusCounts.get(s) ?? 0, color: statusColor(theme, s) })).filter((s) => s.value > 0);

  const refetch = () => {
    filtered.refetch();
    insights.refetch();
    trends.refetch();
    sources.refetch();
  };

  return (
    <Page
      refreshing={filtered.isRefetching || insights.isRefetching || trends.isRefetching || sources.isRefetching}
      onRefresh={refetch}
      contentStyle={{ maxWidth: 720, gap: space.md }}
    >
      <BackLink label="Me" fallback="/staff/me" />
      <PageTitle title="Insights" subtitle={`Last ${PERIOD_LABEL[period]} · ${where} · ${totals.opened} case${totals.opened === 1 ? '' : 's'}`} />

      <View style={{ gap: space.sm }}>
        <ChoiceRow label="Period" options={INSIGHT_PERIODS} value={period} onChange={(p) => setPeriod(p ?? '30')} labels={PERIOD_LABEL} />
        {districtKeys.length ? (
          <ChoiceRow
            label="Police district"
            options={districtKeys}
            value={district}
            onChange={setDistrict}
            labels={districtLabels}
            allowNone
            noneLabel="All"
          />
        ) : null}
      </View>

      <PatternsCard patterns={patterns} days={days} />

      <Button label="Need vs coverage map" icon="map-outline" variant="tinted" onPress={() => router.push('/staff/areas')} />

      <View style={{ gap: 10 }}>
        <View style={styles.tiles}>
          <StatTile label="Opened" value={totals.opened} />
          <StatTile label="Resolved" value={totals.resolved} color={theme.accent} />
        </View>
        <View style={styles.tiles}>
          <StatTile label="Urgent" value={totals.urgent} color={totals.urgent ? theme.danger : undefined} />
          <StatTile label="Avg time to resolve" value={hours(totals.avg_resolution_hours)} color={theme.accent} />
        </View>
        {totals.placed < totals.opened ? (
          <Text style={[type.caption, { color: theme.textSecondary }]}>
            {totals.opened - totals.placed} of these {totals.opened} have no known place yet, so they aren&apos;t in a district or a pattern.
          </Text>
        ) : null}
      </View>

      <Card style={{ gap: space.md }}>
        <CardTitle title="Requests by need" right={<Text style={[type.caption, { color: theme.textSecondary }]}>{PERIOD_LABEL[period]}</Text>} />
        <BarList items={byNeed} empty="No cases in this period." />
      </Card>

      {isAdmin ? <OncallResponse /> : null}

      <AvaImpact />

      <Card style={{ gap: space.md }}>
        <CardTitle title="Where cases stand" right={<Text style={[type.caption, { color: theme.textSecondary }]}>All time</Text>} />
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

/**
 * "Pattern spotted" (Mockups flow 4): repeat cases at one block or
 * intersection, or a neighborhood that doubled. Each links to its cases.
 */
function PatternsCard({ patterns, days }: { patterns: Pattern[]; days: number }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: space.md }}>
      <CardTitle title={patterns.length > 1 ? 'Patterns spotted' : 'Pattern spotted'} icon="sparkles-outline" />
      {patterns.length ? (
        patterns.slice(0, 3).map((p, i) => (
          <View key={`${p.kind}:${p.label}`} style={[{ gap: 6 }, i > 0 && [styles.divider, { borderTopColor: theme.separator }]]}>
            <View style={styles.patternHead}>
              <Ionicons name={p.kind === 'spot' ? 'location-outline' : 'map-outline'} size={18} color={theme.soon} />
              <Text style={[type.headline, { color: theme.text, flex: 1 }]}>{p.headline}</Text>
            </View>
            {p.detail ? <Text style={[type.footnote, { color: theme.textSecondary }]}>{p.detail}</Text> : null}
            <View style={styles.caseLinks}>
              {p.case_ids.slice(0, 6).map((id, n) => (
                <Pressable
                  key={id}
                  onPress={() => {
                    tap();
                    router.push({ pathname: '/staff/cases/[id]', params: { id } });
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={`Open case ${p.case_numbers[n]}`}
                  style={({ pressed }) => [styles.caseLink, { backgroundColor: theme.fill }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[type.footnote, { color: theme.text, fontWeight: '600' }]}>#{p.case_numbers[n]}</Text>
                </Pressable>
              ))}
              {p.case_ids.length > 6 ? <Text style={[type.footnote, { color: theme.textSecondary }]}>+{p.case_ids.length - 6} more</Text> : null}
            </View>
          </View>
        ))
      ) : (
        <Text style={[type.footnote, { color: theme.textSecondary }]}>
          Nothing stands out in the last {days} days. A pattern is 3 or more requests at one block or intersection, or a
          neighborhood with twice as many as the period before.
        </Text>
      )}
    </Card>
  );
}

/**
 * Ava, the phone navigator (GET /v1/voice/dashboard): calls, callers told
 * to call 911, referrals offered and connected. All time; never transcripts.
 */
function AvaImpact() {
  const theme = useTheme();
  const dashboard = useVoiceDashboard();
  const stats = dashboard.data?.stats;
  return (
    <Card style={{ gap: space.md }}>
      <CardTitle title="Ava on the phone" icon="call-outline" right={<Text style={[type.caption, { color: theme.textSecondary }]}>All time</Text>} />
      {stats ? (
        <>
          <View style={styles.tiles}>
            <StatTile label="Calls" value={stats.total_calls} />
            <StatTile label="Told to call 911" value={stats.emergency_redirects} color={stats.emergency_redirects ? theme.danger : undefined} />
          </View>
          <View style={styles.tiles}>
            <StatTile label="Referrals offered" value={stats.referrals_offered} />
            <StatTile label="Connected" value={stats.transfers_connected} color={theme.accent} />
            <StatTile label="Followed up" value={stats.follow_ups_completed} />
          </View>
        </>
      ) : dashboard.error ? (
        <ErrorBanner error={dashboard.error} onRetry={() => dashboard.refetch()} />
      ) : (
        <Loading />
      )}
    </Card>
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
  trendRow: { flexDirection: 'row', gap: space.md, alignItems: 'baseline' },
  trendValue: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  sourceRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md },
  patternHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  caseLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  caseLink: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
});
