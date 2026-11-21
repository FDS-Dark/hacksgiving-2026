import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, ErrorBanner, Group, Header, Notice, Row, Screen, Sheet, Txt, success } from '@/components/ui';
import {
  type CommunityReferral,
  type ReferralStatus,
  useCommunityResponseDashboard,
  useRecordResponderOutcome,
} from '@/services/communityResponse';
import { radius, space, useTheme } from '@/theme/tokens';

const STATUS_LABEL: Record<ReferralStatus, string> = {
  new: 'New',
  connecting: 'Connecting',
  connected: 'Connected',
  'follow-up': 'Follow-up',
};

function minutesAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} min ago`;
}

function Metric({ value, label, accent = false }: { value: string; label: string; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.metric, { backgroundColor: accent ? theme.accent : theme.surface }]}>
      <Txt variant="title" color={accent ? theme.onAccent : theme.text}>{value}</Txt>
      <Txt variant="caption" color={accent ? theme.onAccent : theme.textSecondary}>{label}</Txt>
    </View>
  );
}

function ProgressRow({ label, referrals, max }: { label: string; referrals: number; max: number }) {
  const theme = useTheme();
  const width = `${Math.round((referrals / Math.max(max, 1)) * 100)}%` as `${number}%`;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressLabels}>
        <Txt variant="subhead">{label}</Txt>
        <Txt variant="caption" tone="secondary">{referrals} referrals</Txt>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: theme.fill }]}>
        <View style={[styles.progressFill, { width, backgroundColor: theme.brand }]} />
      </View>
    </View>
  );
}

export default function ResponseScreen() {
  const theme = useTheme();
  const response = useCommunityResponseDashboard();
  const recordOutcome = useRecordResponderOutcome();
  const [selected, setSelected] = useState<CommunityReferral | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ReferralStatus>>({});
  const data = response.data?.dashboard;
  const largestCategory = Math.max(...(data?.weeklyImpact.map((item) => item.referrals) ?? [1]));
  const referrals = useMemo(
    () => (data?.activeReferrals ?? []).map((item) => ({ ...item, status: statuses[item.id] ?? item.status })),
    [data?.activeReferrals, statuses],
  );

  const updateStatus = (status: ReferralStatus) => {
    if (!selected) return;
    setStatuses((current) => ({ ...current, [selected.id]: status }));
    setSelected((current) => current ? { ...current, status } : null);
    success();
  };

  const persistStatus = async (status: ReferralStatus, outcome: 'connected' | 'follow_up_needed' | 'completed') => {
    if (!selected) return;
    if (!response.data?.isDemo) {
      try {
        await recordOutcome.mutateAsync({ referralId: selected.id, status: outcome });
      } catch {
        return;
      }
    }
    updateStatus(status);
  };

  return (
    <>
      <Screen refreshing={response.isRefetching} onRefresh={response.refetch}>
        <Header title="Response desk" subtitle="Privacy-safe handoffs and follow-up for ComForce partners." />

        {response.data?.isDemo ? (
          <Notice icon="flask-outline" tone="warning">
            Demo mode uses synthetic calls. No person, phone number, or case record is represented here.
          </Notice>
        ) : null}

        <View style={[styles.queueHero, { backgroundColor: theme.surface }]}>
          <View style={styles.heroTop}>
            <View style={[styles.heroIcon, { backgroundColor: theme.freshSoft }]}>
              <Ionicons name="headset-outline" size={26} color={theme.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="headline">Community response is online</Txt>
              <Txt variant="subhead" tone="secondary">{referrals.length} active referrals · refreshed every minute</Txt>
            </View>
            <View style={[styles.liveBadge, { backgroundColor: theme.freshSoft }]}>
              <View style={[styles.liveDot, { backgroundColor: theme.fresh }]} />
              <Txt variant="caption" color={theme.fresh}>Live</Txt>
            </View>
          </View>
          <Txt variant="footnote" tone="secondary">
            Consequential decisions stay with trained people. The assistant gathers only enough context to make a safe handoff.
          </Txt>
        </View>

        {data ? (
          <View style={styles.metricsGrid}>
            <Metric value={String(data.stats.callsToday)} label="calls today" accent />
            <Metric value={`${data.stats.connectedRate}%`} label="connected" />
            <Metric value={String(data.stats.emergencyRedirects)} label="sent to 911" />
            <Metric value={String(data.stats.openFollowUps)} label="follow-ups" />
          </View>
        ) : null}

        <Group
          header={`Active referrals · ${referrals.length}`}
          footer="Only a generalized area and minimum handoff summary are shown. Raw audio, transcripts, names, and phone numbers are not retained."
        >
          {referrals.map((referral) => {
            const priority = referral.urgency === 'priority';
            const statusColor = referral.status === 'connected' ? theme.fresh : priority ? theme.soon : theme.accent;
            const statusTint = referral.status === 'connected' ? theme.freshSoft : priority ? theme.warningSoft : theme.accentSoft;
            return (
              <Row
                key={referral.id}
                title={referral.category}
                subtitle={`${referral.generalArea} · ${minutesAgo(referral.receivedAt)} · ${referral.language}`}
                detail={STATUS_LABEL[referral.status]}
                detailColor={statusColor}
                detailTint={statusTint}
                tile={{ icon: priority ? 'account-alert' : 'hand-heart', color: priority ? theme.soon : theme.brand }}
                accessory="chevron"
                onPress={() => setSelected(referral)}
              />
            );
          })}
        </Group>

        {data ? (
          <View style={[styles.impact, { backgroundColor: theme.surface }]}>
            <View style={styles.sectionTitle}>
              <View>
                <Txt variant="title">Seven-day impact</Txt>
                <Txt variant="subhead" tone="secondary">Aggregate outcomes only</Txt>
              </View>
              <Ionicons name="analytics-outline" size={25} color={theme.accent} />
            </View>
            <View style={{ gap: space.lg }}>
              {data.weeklyImpact.map((item) => (
                <ProgressRow key={item.label} label={item.label} referrals={item.referrals} max={largestCategory} />
              ))}
            </View>
          </View>
        ) : null}

        {data ? (
          <Group header="Verified routing directory" footer="Public-service transfers must be partner-approved before they are enabled in the voice agent.">
            {data.routes.map((route) => (
              <Row
                key={route.id}
                title={route.label}
                subtitle={`${route.destination} · ${route.availability}`}
                detail={route.status === 'ready' ? 'Ready' : 'Limited'}
                detailColor={route.status === 'ready' ? theme.fresh : theme.soon}
                detailTint={route.status === 'ready' ? theme.freshSoft : theme.warningSoft}
                tile={{ icon: route.status === 'ready' ? 'phone-check' : 'phone-clock', color: route.status === 'ready' ? theme.brand : theme.soon }}
              />
            ))}
          </Group>
        ) : null}

        <Notice icon="shield-checkmark-outline">
          If a caller reports immediate danger, a weapon, serious injury, fire, overdose, or a crime in progress, the assistant tells them to hang up and dial 911 directly.
        </Notice>
      </Screen>

      <Sheet
        visible={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.category}
        subtitle={selected ? `${selected.generalArea} · ${minutesAgo(selected.receivedAt)}` : undefined}
      >
        {selected ? (
          <>
            <View style={styles.summaryBlock}>
              <Txt variant="headline">Minimum necessary summary</Txt>
              <Txt tone="secondary">{selected.summary}</Txt>
            </View>

            <Group header="Handoff">
              <Row title="Destination" detail={selected.destination} tile={{ icon: 'account-arrow-right', color: theme.brand }} />
              <Row title="Language" detail={selected.language} tile={{ icon: 'translate', color: theme.accent }} />
              <Row title="Status" detail={STATUS_LABEL[selected.status]} tile={{ icon: 'progress-check', color: theme.soon }} />
            </Group>

            <View style={[styles.privacyNote, { backgroundColor: theme.freshSoft }]}>
              <Ionicons name="lock-closed-outline" size={21} color={theme.brand} />
              <Txt variant="subhead" tone="secondary" style={{ flex: 1 }}>
                The caller’s number and full conversation are intentionally unavailable. Ask for identifying details only if the caller chooses to share them after connection.
              </Txt>
            </View>

            <View style={styles.actions}>
              {recordOutcome.error ? <ErrorBanner error={recordOutcome.error} /> : null}
              {selected.status === 'new' ? <Button label="Accept handoff" icon="headset-outline" size="lg" onPress={() => updateStatus('connecting')} /> : null}
              {selected.status === 'connecting' ? <Button label="Mark connected" icon="checkmark-circle-outline" size="lg" loading={recordOutcome.isPending} onPress={() => persistStatus('connected', 'connected')} /> : null}
              {selected.status === 'connected' ? <Button label="Schedule follow-up" icon="time-outline" size="lg" loading={recordOutcome.isPending} onPress={() => persistStatus('follow-up', 'follow_up_needed')} /> : null}
              {selected.status === 'follow-up' ? <Button label="Close follow-up" icon="checkmark-done-outline" size="lg" loading={recordOutcome.isPending} onPress={() => persistStatus('connected', 'completed')} /> : null}
            </View>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  queueHero: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  heroTop: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: space.sm, paddingVertical: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  metric: { width: '48%', flexGrow: 1, borderRadius: radius.lg, padding: space.lg, gap: 2, minHeight: 86, justifyContent: 'center' },
  impact: { borderRadius: radius.lg, padding: space.lg, gap: space.xl },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressRow: { gap: 7 },
  progressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4 },
  summaryBlock: { gap: space.sm },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, borderRadius: radius.lg, padding: space.md },
  actions: { alignItems: 'stretch', gap: space.sm },
});
