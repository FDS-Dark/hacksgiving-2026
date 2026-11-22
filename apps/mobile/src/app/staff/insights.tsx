import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Pattern } from '@/api/types';
import { CASE_STATUSES } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ErrorBanner, Group, Loading, Row, tap } from '@/components/ui';
import { BarList, Card, CardTitle, ChoiceRow, MoreDetails, PageTitle, StatTile, statusColor } from '@/components/staff/kit';
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

  const refetch = () => {
    filtered.refetch();
    insights.refetch();
    trends.refetch();
    sources.refetch();
  };

  // The header stays up while loading and on errors (fix plan 2C).
  const header = (
    <>
      <BackLink to="/staff/me" label="Me" />
      <PageTitle title="Insights" />
    </>
  );
  if (filtered.isPending || insights.isPending) {
    return (
      <Page contentStyle={{ maxWidth: 720, gap: space.md }}>
        {header}
        <Loading label="Loading insights" />
      </Page>
    );
  }
  const failed = filtered.error ?? insights.error;
  if (failed || !filtered.data || !insights.data) {
    return (
      <Page contentStyle={{ maxWidth: 720, gap: space.md }}>
        {header}
        <ErrorBanner error={failed} onRetry={refetch} />
      </Page>
    );
  }
  const comparison = yearOverYear(trends.data ?? []);
  const { totals, by_category, patterns, districts } = filtered.data;
  const { by_status, recent_activity } = insights.data;

  const districtKeys = districts.map((d) => d.key);
  const districtLabels = Object.fromEntries(districts.map((d) => [d.key, `District ${d.name}`]));
  const where = district ? districtLabels[district] ?? `District ${district}` : 'all districts';

  const byNeed = [...by_category]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ key: c.category, label: CATEGORY_LABEL[c.category], value: c.total, color: theme.accent, detail: c.active ? `${c.active} open` : undefined }));
  const top = byNeed[0];

  const statusCounts = new Map(by_status.map((s) => [s.status, s.total]));
  const byStatus = CASE_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], value: statusCounts.get(s) ?? 0, color: statusColor(theme, s) })).filter((s) => s.value > 0);

  return (
    <Page
      refreshing={filtered.isRefetching || insights.isRefetching || trends.isRefetching || sources.isRefetching}
      onRefresh={refetch}
      contentStyle={{ maxWidth: 720, gap: space.md }}
    >
      {header}
      <ChoiceRow label="Period" options={INSIGHT_PERIODS} value={period} onChange={(p) => setPeriod(p ?? '30')} labels={PERIOD_LABEL} />

      {/* One headline first (cognitive-load review, top 10: Insights had 38 actions at once). */}
      <Card style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.title, { color: theme.text }]}>
          {totals.opened} case{totals.opened === 1 ? '' : 's'} in the last {PERIOD_LABEL[period]}
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          {totals.resolved} resolved
          {totals.urgent ? ` · ${totals.urgent} urgent` : ''}
          {top ? ` · most for ${top.label.toLowerCase()}` : ''} · {where}
        </Text>
      </Card>

      <Group>
        <Row
          title="Where help is needed"
          subtitle="Areas with high need and little ComForce support"
          tile={{ icon: 'map-marker-radius-outline', color: theme.accent }}
          accessory="chevron"
          onPress={() => router.push('/staff/areas')}
        />
      </Group>

      {districtKeys.length ? (
        <MoreDetails label="Filter by police district" hint={district ? districtLabels[district] : 'All districts'}>
          <ChoiceRow label="Police district" options={districtKeys} value={district} onChange={setDistrict} labels={districtLabels} allowNone noneLabel="All" />
        </MoreDetails>
      ) : null}

      <MoreDetails label={patterns.length > 1 ? 'Patterns spotted' : 'Pattern spotted'} hint={patterns.length ? patterns[0].headline : 'Nothing stands out'}>
        <PatternsCard patterns={patterns} days={days} />
      </MoreDetails>

      <MoreDetails label="Cases by type of help" hint={`${PERIOD_LABEL[period]} · resolved, urgent and time to resolve`}>
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
          <BarList items={byNeed} empty="No cases in this period." />
        </Card>
      </MoreDetails>

      <MoreDetails label="Where cases stand" hint="All time, by status">
        <Card style={{ gap: space.md }}>
          <BarList items={byStatus} empty="No cases yet." />
        </Card>
      </MoreDetails>

      {isAdmin ? (
        <MoreDetails label="Urgent response" hint="Last 30 days">
          <OncallResponse />
        </MoreDetails>
      ) : null}

      <MoreDetails label="Phone agent" hint="Call outcomes and places we recommended">
        <PhoneAgentImpact />
      </MoreDetails>

      <MoreDetails label="Milwaukee violence trend" hint="FBI reported offenses, year over year">
        <Card style={{ gap: space.sm }}>
          {comparison ? (
            <>
              <View style={styles.trendRow}>
                <Text style={[styles.trendValue, { color: comparison.percentChange != null && comparison.percentChange <= 0 ? theme.accent : theme.danger }]}>
                  {comparison.percentChange == null ? '—' : `${comparison.percentChange > 0 ? '+' : ''}${comparison.percentChange.toFixed(1)}%`}
                </Text>
                <Text style={[type.subhead, { color: theme.textSecondary, flex: 1 }]}>the last 12 months compared with the 12 before</Text>
              </View>
              <Text style={[type.footnote, { color: theme.textSecondary }]}>
                {comparison.current.toLocaleString()} reported offenses, compared with {comparison.previous.toLocaleString()} · through{' '}
                {new Date(`${comparison.latestMonth}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
              </Text>
            </>
          ) : (
            <Text style={[type.subhead, { color: theme.textSecondary }]}>We need two full years of FBI data before we can compare them fairly.</Text>
          )}
          <Text style={[type.caption, { color: theme.textSecondary }]}>Reported numbers can change later and don’t predict safety. Source: FBI Crime Data Explorer.</Text>
        </Card>
      </MoreDetails>

      <MoreDetails label="Data freshness" hint="When each public data source last updated">
        <Card style={{ gap: space.sm }}>
          {sources.data?.length ? (
            sources.data.map((source) => {
              const isCurrent = source.status === 'ok';
              const successfulAt = source.last_success_at ?? (isCurrent ? source.finished_at : null);
              return (
                <View key={`${source.source}-${source.target}`} style={[styles.sourceRow, { borderTopColor: theme.separator }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>{sourceLabel(source.source)}</Text>
                    <Text style={[type.caption, { color: theme.textSecondary }]}>{successfulAt ? `Last updated ${dateTime(successfulAt)}` : 'Not updated yet'}</Text>
                  </View>
                  <Text style={[type.caption, { color: isCurrent ? theme.accent : theme.soon, fontWeight: '700' }]}>{isCurrent ? 'Current' : source.status.replaceAll('_', ' ')}</Text>
                </View>
              );
            })
          ) : sources.error ? (
            <ErrorBanner error={sources.error} onRetry={() => sources.refetch()} />
          ) : (
            <Text style={[type.subhead, { color: theme.textSecondary }]}>Source status isn’t available right now.</Text>
          )}
        </Card>
      </MoreDetails>

      {recent_activity.length ? (
        <MoreDetails label="Recent activity" hint="The latest updates across all cases">
          <Card style={{ gap: space.sm }}>
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
        </MoreDetails>
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
 * The phone agent (GET /v1/voice/dashboard): calls, callers told
 * to call 911, referrals offered and connected. All time; never transcripts.
 */
function PhoneAgentImpact() {
  const theme = useTheme();
  const dashboard = useVoiceDashboard();
  const stats = dashboard.data?.stats;
  return (
    <Card style={{ gap: space.md }}>
      <CardTitle title="Phone agent" icon="call-outline" right={<Text style={[type.caption, { color: theme.textSecondary }]}>All time</Text>} />
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
