import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoiceCallReview } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { EmptyState, ErrorBanner, Loading, Notice } from '@/components/ui';
import { Badge, Card, PageTitle, StatTile } from '@/components/staff/kit';
import { dateTime, timeAgo } from '@/lib/format';
import { useStaffVoiceCalls, useVoiceImpact } from '@/services/voice';
import { radius, space, type, useTheme } from '@/theme/tokens';

function label(value: string | null | undefined, fallback: string) {
  return value ? value.replaceAll('-', ' ').replaceAll('_', ' ') : fallback;
}

function CallCard({ call }: { call: VoiceCallReview }) {
  const theme = useTheme();
  const when = call.started_at ?? call.created_at;
  const urgent = call.urgency_tier === 'emergency' || call.urgency_tier === 'urgent';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/staff/calls/[id]', params: { id: call.id } })}
      accessibilityRole="link"
      accessibilityLabel={`Review ${label(call.need_category, 'community support')} call from ${dateTime(when)}`}
      style={({ pressed }) => [
        styles.callCard,
        { backgroundColor: theme.surface, borderColor: theme.separator },
        pressed && { opacity: 0.72 },
      ]}
    >
      <View style={[styles.callIcon, { backgroundColor: urgent ? theme.dangerSoft : theme.accentSoft }]}>
        <Ionicons name={urgent ? 'alert-circle-outline' : 'call-outline'} size={22} color={urgent ? theme.danger : theme.accent} />
      </View>
      <View style={{ flex: 1, gap: 7 }}>
        <View style={styles.cardTop}>
          <Text style={[styles.callTitle, { color: theme.text }]} numberOfLines={1}>
            {label(call.need_category, 'Community support')}
          </Text>
          <Text style={[type.caption, { color: theme.textSecondary }]}>{timeAgo(when)}</Text>
        </View>
        <View style={styles.badges}>
          {call.urgency_tier ? (
            <Badge
              label={label(call.urgency_tier, 'Routine')}
              color={urgent ? theme.danger : theme.textSecondary}
              icon={urgent ? 'warning-outline' : undefined}
            />
          ) : null}
          <Badge
            label={`${call.referral_count} referral${call.referral_count === 1 ? '' : 's'}`}
            color={call.referral_count ? theme.accent : theme.textSecondary}
            icon="link-outline"
          />
          {call.request_number ? <Badge label={`Request #${call.request_number}`} color={theme.brand} icon="document-text-outline" /> : null}
        </View>
        <Text style={[type.footnote, { color: theme.textSecondary }]} numberOfLines={2}>
          {call.referral_names.length ? call.referral_names.join(' · ') : label(call.disposition, 'No referral recorded')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

export default function StaffCallsScreen() {
  const theme = useTheme();
  const calls = useStaffVoiceCalls();
  const impact = useVoiceImpact();
  const items = calls.data ?? [];
  const referred = items.filter((call) => call.referral_count > 0).length;

  return (
    <Page refreshing={calls.isRefetching} onRefresh={() => calls.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink to="/staff/me" label="Me" />
      <PageTitle title="AI phone calls" subtitle="Structured outcomes for staff review — never recordings or transcripts." />

      <Notice icon="shield-checkmark-outline">
        These records contain only routing fields the caller chose to share. Caller phone numbers, raw audio, transcripts, and exact addresses are not stored.
      </Notice>

      {calls.isPending ? (
        <Loading label="Loading phone calls" />
      ) : calls.error ? (
        <ErrorBanner error={calls.error} onRetry={() => calls.refetch()} />
      ) : (
        <>
          <View style={styles.stats}>
            <StatTile label="Calls" value={impact.data?.total_calls ?? items.length} color={theme.accent} />
            <StatTile label="Routed" value={impact.data?.routed_calls ?? referred} color={theme.brand} />
            <StatTile label="Help confirmed" value={impact.data?.residents_helped ?? 0} color={theme.accent} />
          </View>
          <Card style={{ gap: space.sm }}>
            <Text style={[type.headline, { color: theme.text }]}>Connection funnel</Text>
            <Text style={[type.subhead, { color: theme.textSecondary }]}>Referrals accepted: {impact.data?.referrals_accepted ?? 0} · attempts: {impact.data?.connection_attempts ?? 0} · follow-ups due: {impact.data?.follow_ups_due ?? 0}</Text>
            {(impact.data?.incomplete_calls ?? 0) > 0 || (impact.data?.tool_failures ?? 0) > 0 ? (
              <Text style={[type.footnote, { color: theme.soon }]}>Needs review: {impact.data?.incomplete_calls ?? 0} incomplete calls · {impact.data?.tool_failures ?? 0} provider/tool failures</Text>
            ) : null}
          </Card>

          {items.length ? (
            <View style={{ gap: space.sm }}>
              {items.map((call) => <CallCard key={call.id} call={call} />)}
            </View>
          ) : (
            <Card>
              <EmptyState
                icon="call-outline"
                title="No calls to review"
                body="Completed AI phone calls will appear here after their privacy-safe routing data is saved."
              />
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: space.sm },
  callCard: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  callIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  callTitle: { flex: 1, fontSize: 17, fontWeight: '800', textTransform: 'capitalize' },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
});
