import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { PinMap, hasLocation, type Pin } from '@/components/PinMap';
import { CardSkeleton } from '@/components/Skeleton';
import { Badge, Card, CardTitle } from '@/components/staff/kit';
import { Call911Line, CaseLinkRow, OutlineButton, PassSheet, useNow } from '@/components/staff/Urgent';
import { Button, ErrorBanner, Group, Notice, success } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/cases';
import { locationAllowed } from '@/lib/location';
import { clock } from '@/lib/oncall';
import { PLAYBOOKS } from '@/lib/playbooks';
import { alertView, distanceLabel, hasPendingOffer, milesBetween, movesOnLabel, takenLabel, type LatLng } from '@/lib/urgent';
import { useDeviceLocation } from '@/services/deviceLocation';
import { oncallAlertError, useAcceptAlert, useAlert, useArrived, usePassAlert, type OncallAlertDetail, type PassReason } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { radius, space, type, useTheme } from '@/theme/tokens';

/**
 * Figma Mockups flow 3, screens 2 and 3: an urgent alert. Respond while it's
 * open (accept or pass, with the 911 line first), Responding once I've
 * accepted, "Taken by …" when someone else did, and a notice once it's closed.
 * Refreshes every 5 s, so a teammate's accept flips the screen.
 */
export default function AlertScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useAlert(id);
  const me = useStaffStatus();
  const accept = useAcceptAlert();
  const pass = usePassAlert();
  const arrived = useArrived();

  if (detail.isPending) {
    return (
      <Page contentStyle={{ maxWidth: 720, gap: space.lg }}>
        <BackLink label="Today" fallback="/staff" />
        <CardSkeleton lines={3} />
      </Page>
    );
  }
  if (!detail.data) {
    return (
      <Page contentStyle={{ maxWidth: 720 }}>
        <BackLink label="Today" fallback="/staff" />
        <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />
      </Page>
    );
  }

  const a = detail.data;
  const view = alertView(a, me.data?.id);
  const failure = accept.error ?? pass.error ?? arrived.error;
  const errorBanner = failure ? <ErrorBanner error={oncallAlertError(failure)} /> : null;

  if (view === 'respond') return <Respond alert={a} error={errorBanner} accept={accept} pass={pass} refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} />;
  if (view === 'responding') return <Responding alert={a} error={errorBanner} arrived={arrived} refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} />;

  return (
    <Page refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Today" fallback="/staff" />
      {errorBanner}
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
        #{a.case_number} {a.case_title}
      </Text>
      {view === 'taken' ? (
        <Notice icon="person-outline">
          {takenLabel(a)}
          {a.accepted_at ? ` at ${clock(a.accepted_at)}` : ''}. They’re on their way; nothing more is needed from you.
        </Notice>
      ) : (
        <Notice icon="checkmark-circle-outline">
          {a.status === 'resolved'
            ? 'This alert is closed: someone was assigned to the case by hand.'
            : 'This alert was called off: the case was resolved or closed.'}
        </Notice>
      )}
      <Group>
        <CaseLinkRow caseId={a.case_id} caseNumber={a.case_number} />
      </Group>
    </Page>
  );
}

// ── Respond ──────────────────────────────────────────────────────────────

function Respond({
  alert: a,
  error,
  accept,
  pass,
  refreshing,
  onRefresh,
}: {
  alert: OncallAlertDetail;
  error: React.ReactNode;
  accept: ReturnType<typeof useAcceptAlert>;
  pass: ReturnType<typeof usePassAlert>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const [passing, setPassing] = useState(false);
  const pending = hasPendingOffer(a);
  const busy = accept.isPending || pass.isPending;

  const onAccept = () => accept.mutate(a.id, { onSuccess: () => success() });
  const onPass = (reason: PassReason | null) =>
    pass.mutate(
      { id: a.id, reason },
      {
        onSuccess: () => {
          setPassing(false);
          if (router.canGoBack()) router.back();
          else router.replace('/staff');
        },
        onError: () => setPassing(false),
      },
    );

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.urgentBar, { backgroundColor: theme.red }]} accessibilityRole="header">
        <Ionicons name="warning-outline" size={18} color="#FFFFFF" />
        <Text style={[type.subhead, styles.urgentBarText]}>Urgent · {CATEGORY_LABEL[a.category]}</Text>
      </View>
      <Page refreshing={refreshing} onRefresh={onRefresh} contentStyle={{ maxWidth: 720, gap: space.lg, paddingTop: space.md }}>
        <BackLink label="Today" fallback="/staff" />
        <Call911Line />
        {error}
        <Text style={[styles.title, { color: theme.text }]} selectable>
          {a.case_title}
        </Text>
        <CaseMap alert={a} />
        <Distance alert={a} />
        <WhatWeKnow alert={a} />
        {pending && a.my_offer ? (
          <Countdown alert={a} expiresAt={a.my_offer.expires_at} />
        ) : a.status === 'unanswered' ? (
          <Notice icon="alert-circle-outline" tone="warning">
            Nobody has accepted #{a.case_number} yet. Anyone on staff can take it.
          </Notice>
        ) : null}
      </Page>
      <View style={[styles.actions, { borderTopColor: theme.separator, backgroundColor: theme.bg }]}>
        <Button label="Accept and head there" size="lg" loading={accept.isPending} disabled={pass.isPending} onPress={onAccept} />
        {pending ? (
          <OutlineButton label="Pass to next on call" size="lg" disabled={busy} onPress={() => setPassing(true)} />
        ) : null}
      </View>
      <PassSheet visible={passing} onClose={() => setPassing(false)} onPass={onPass} loading={pass.isPending} />
    </View>
  );
}

/** "Moves to Devon in 4:32", ticking every second (its own component, so the map doesn't re-render). */
function Countdown({ alert, expiresAt }: { alert: OncallAlertDetail; expiresAt: string }) {
  const theme = useTheme();
  const now = useNow();
  return (
    <View style={[styles.countdown, { backgroundColor: theme.warningSoft }]} accessibilityLiveRegion="polite">
      <Ionicons name="time-outline" size={18} color={theme.soon} />
      <Text style={[type.subhead, { color: theme.soon, fontWeight: '600', flex: 1 }]}>{movesOnLabel(alert, expiresAt, now)}</Text>
    </View>
  );
}

function WhatWeKnow({ alert: a }: { alert: OncallAlertDetail }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: space.xs }}>
      <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '600' }]}>What we know</Text>
      <Text style={[type.body, { color: theme.text }]} selectable>
        {a.description?.trim() || 'No description yet.'} Reported {clock(a.created_at)}.
      </Text>
      {a.location ? (
        <Text style={[type.subhead, { color: theme.textSecondary }]} selectable>
          {a.location}
        </Text>
      ) : null}
      {a.safe_to_contact === false ? (
        <Text style={[type.footnote, { color: theme.danger, fontWeight: '600' }]}>Not safe to contact them directly.</Text>
      ) : null}
    </Card>
  );
}

// ── Responding ───────────────────────────────────────────────────────────

function Responding({
  alert: a,
  error,
  arrived,
  refreshing,
  onRefresh,
}: {
  alert: OncallAlertDetail;
  error: React.ReactNode;
  arrived: ReturnType<typeof useArrived>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  const steps = PLAYBOOKS[a.category]?.steps.slice(0, 3) ?? [];

  return (
    <View style={{ flex: 1 }}>
      <Page refreshing={refreshing} onRefresh={onRefresh} contentStyle={{ maxWidth: 720, gap: space.lg }}>
        <BackLink label="Today" fallback="/staff" />
        <View style={styles.respondingHead}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text, flex: 1 }]}>
            Responding
          </Text>
          <Badge label="Accepted" color={theme.accent} icon="checkmark" />
        </View>
        {error}
        <CaseMap alert={a} />
        <View style={{ gap: 2 }}>
          <Text style={[type.headline, { color: theme.text }]} selectable>
            {a.location || a.case_title}
          </Text>
          <Text style={[type.footnote, { color: theme.textSecondary }]}>
            #{a.case_number} {a.case_title} · staff can see you’re on your way
          </Text>
        </View>
        <Distance alert={a} />
        {steps.length ? (
          <Card style={{ gap: space.sm }}>
            <CardTitle title="On arrival" />
            {steps.map((s) => (
              <View key={s} style={styles.step}>
                <View style={[styles.bullet, { backgroundColor: theme.accent }]} />
                <Text style={[type.subhead, { color: theme.text, flex: 1 }]}>{s}</Text>
              </View>
            ))}
          </Card>
        ) : null}
        <Group>
          <CaseLinkRow caseId={a.case_id} caseNumber={a.case_number} />
        </Group>
      </Page>
      <View style={[styles.actions, styles.actionsRow, { borderTopColor: theme.separator, backgroundColor: theme.bg }]}>
        <View style={{ flex: 1 }}>
          {a.arrived_at ? (
            <Button label={`On scene · ${clock(a.arrived_at)}`} size="lg" icon="location" variant="tinted" disabled onPress={() => undefined} />
          ) : (
            <Button label="I’ve arrived" size="lg" icon="location-outline" loading={arrived.isPending} onPress={() => arrived.mutate(a.id, { onSuccess: () => success() })} />
          )}
        </View>
      </View>
    </View>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────

/** The case's pin, when it has coordinates. Pins are memoized on primitives so refetches don't reload the map. */
function CaseMap({ alert: a }: { alert: OncallAlertDetail }) {
  const theme = useTheme();
  const { id, case_number: n, latitude, longitude } = a;
  const color = theme.red;
  const pins = useMemo<Pin[]>(
    () => (latitude !== null && longitude !== null ? [{ id, latitude, longitude, label: `#${n}`, color }] : []),
    [id, n, latitude, longitude, color],
  );
  if (!hasLocation(a)) return null;
  return (
    <View style={styles.map}>
      <PinMap pins={pins} onSelect={() => undefined} />
    </View>
  );
}

/**
 * "1.2 mi away · about 6 min drive", from this phone's location and the
 * case's coordinates. Worked out here and never sent anywhere. Asks for
 * the location only when tapped, unless the app may already read it.
 */
function Distance({ alert: a }: { alert: OncallAlertDetail }) {
  const theme = useTheme();
  const device = useDeviceLocation();
  const target: LatLng | null = hasLocation(a) ? { latitude: a.latitude, longitude: a.longitude } : null;
  const hasTarget = !!target;

  useEffect(() => {
    if (!hasTarget) return;
    let live = true;
    locationAllowed().then((ok) => {
      if (ok && live) device.locate();
    });
    return () => {
      live = false;
    };
    // Once per alert: locate() is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTarget]);

  if (!target) return null;
  if (device.location) {
    return (
      <View style={styles.distance}>
        <Ionicons name="navigate-outline" size={16} color={theme.text} />
        <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]}>{distanceLabel(milesBetween(device.location, target))}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: space.xs }}>
      <Button label="Show distance" icon="navigate-outline" variant="plain" loading={device.loading} onPress={() => device.locate()} style={styles.showDistance} />
      {device.error ? <Text style={[type.footnote, { color: theme.textSecondary }]}>{device.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  urgentBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  urgentBarText: { color: '#FFFFFF', fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  map: { height: 200, borderRadius: radius.lg, overflow: 'hidden' },
  distance: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  showDistance: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm },
  actions: { gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  actionsRow: { flexDirection: 'row' },
  respondingHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
});
