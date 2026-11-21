import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import type { VoiceReferralDetail } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Button, ErrorBanner, Loading, Notice } from '@/components/ui';
import { Badge, Card, CardTitle, Detail, PageTitle } from '@/components/staff/kit';
import { dateTime } from '@/lib/format';
import { useStaffVoiceCall } from '@/services/voice';
import { space, type, useTheme } from '@/theme/tokens';

function label(value: string | null | undefined, fallback = 'Not recorded') {
  return value ? value.replaceAll('-', ' ').replaceAll('_', ' ') : fallback;
}

function ReferralCard({ referral }: { referral: VoiceReferralDetail }) {
  const theme = useTheme();
  const completed = referral.outcome_status === 'connected' || referral.outcome_status === 'completed';
  const outcomeColor = completed ? theme.brand : referral.outcome_status ? theme.soon : theme.textSecondary;
  return (
    <Card style={{ gap: space.md }}>
      <CardTitle
        title={referral.resource_name}
        icon="link-outline"
        right={<Badge label={label(referral.outcome_status ?? referral.status)} color={outcomeColor} />}
      />
      <Text style={[type.subhead, { color: theme.textSecondary }]}>{referral.resource_description}</Text>
      <View style={styles.details}>
        <Detail label="Service">{label(referral.resource_category)}</Detail>
        <Detail label="Area">{referral.service_area}</Detail>
        <Detail label="Hours">{referral.hours_label ?? 'Call for hours'}</Detail>
        <Detail label="Languages">{referral.languages.join(', ').toUpperCase()}</Detail>
      </View>
      {referral.outcome_reason_code ? (
        <Notice icon="information-circle-outline">Outcome note: {label(referral.outcome_reason_code)}</Notice>
      ) : null}
      {referral.phone_e164 ? (
        <Button label={`Call ${referral.resource_name}`} icon="call-outline" variant="tinted" onPress={() => Linking.openURL(`tel:${referral.phone_e164}`)} />
      ) : null}
    </Card>
  );
}

export default function StaffCallDetailScreen() {
  const theme = useTheme();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const review = useStaffVoiceCall(id);

  if (review.isPending) return <Loading label="Loading call review" />;
  if (review.error || !review.data) {
    return (
      <Page>
        <BackLink label="AI phone calls" fallback="/staff/calls/index" />
        <ErrorBanner error={review.error ?? new Error('Call review not found')} onRetry={() => review.refetch()} />
      </Page>
    );
  }

  const { call, referrals } = review.data;
  const when = call.started_at ?? call.created_at;
  const ended = call.ended_at ? dateTime(call.ended_at) : null;
  const urgent = call.urgency_tier === 'urgent' || call.urgency_tier === 'emergency';

  return (
    <Page refreshing={review.isRefetching} onRefresh={() => review.refetch()} contentStyle={{ maxWidth: 720, gap: space.md }}>
      <BackLink label="AI phone calls" fallback="/staff/calls/index" />
      <PageTitle
        title={label(call.need_category, 'Community support call')}
        subtitle={`${dateTime(when)}${ended ? ` – ${ended}` : ''}`}
        right={call.urgency_tier ? <Badge label={label(call.urgency_tier)} color={urgent ? theme.danger : theme.textSecondary} icon={urgent ? 'warning-outline' : undefined} /> : undefined}
      />

      <Notice icon="lock-closed-outline">
        Privacy-safe review: no caller number, recording, transcript, exact address, or AI-generated risk score is available.
      </Notice>

      <Card style={{ gap: space.lg }}>
        <CardTitle title="Routing outcome" icon="git-branch-outline" />
        <View style={styles.details}>
          <Detail label="Need">{label(call.need_category)}</Detail>
          <Detail label="Urgency">{label(call.urgency_tier, 'Not assigned')}</Detail>
          <Detail label="Disposition">{label(call.disposition)}</Detail>
          <Detail label="Callback consent">{call.callback_consent ? 'Yes' : 'No'}</Detail>
          <Detail label="Referrals">{String(call.referral_count)}</Detail>
          {call.request_number ? <Detail label="Linked request">#{call.request_number}</Detail> : null}
        </View>
        {call.request_id ? (
          <Button
            label={call.request_number ? `Open request #${call.request_number}` : 'Open linked request'}
            icon="document-text-outline"
            variant="tinted"
            onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: call.request_id! } })}
          />
        ) : null}
      </Card>

      <View style={styles.sectionHeading}>
        <View style={[styles.sectionIcon, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="link-outline" size={19} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>Referrals</Text>
          <Text style={[type.footnote, { color: theme.textSecondary }]}>{referrals.length} resource{referrals.length === 1 ? '' : 's'} offered</Text>
        </View>
      </View>

      {referrals.length ? referrals.map((referral) => <ReferralCard key={referral.id} referral={referral} />) : (
        <Card>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>No resource referral was recorded for this call.</Text>
        </Card>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  sectionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
});
