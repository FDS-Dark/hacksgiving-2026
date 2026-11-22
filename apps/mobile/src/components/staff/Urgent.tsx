/**
 * Urgent escalation pieces shared by Today (the red banners), S7 (the urgent
 * offer card) and the Respond screen (/staff/alerts/[id]): a ticking clock,
 * the call-911 reminder and the Pass reason sheet.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/staff/kit';
import { Button, Row, Sheet, success } from '@/components/ui';
import { bannerLine, bannerTitle, offerLine } from '@/lib/urgent';
import { PASS_REASONS, oncallAlertError, useAcceptAlert, usePassAlert, type OncallAlert, type PassReason } from '@/services/oncall';
import { radius, space, type, useTheme } from '@/theme/tokens';

/** The current time in ms, ticking every `intervalMs` while mounted (for countdowns). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The alert's screen. */
export function alertHref(id: string): Href {
  return { pathname: '/staff/alerts/[id]', params: { id } } as Href;
}

/** "If anyone may be hurt or armed, call 911 first." A reminder, not a
 *  button: the app never dials 911; the worker calls from their phone. */
export function Call911Line() {
  const theme = useTheme();
  return (
    <View style={[styles.line911, { backgroundColor: theme.dangerSoft }]}>
      <Ionicons name="warning-outline" size={18} color={theme.danger} />
      <Text style={[type.footnote, { color: theme.danger, fontWeight: '600', flex: 1 }]}>
        If anyone may be hurt or armed, call 911 from your phone first.
      </Text>
    </View>
  );
}

/** A white button with a hairline border, for the secondary choice beside a green primary (Pass, as in the Figma). */
export function OutlineButton({ label, onPress, disabled, size = 'md', style }: { label: string; onPress: () => void; disabled?: boolean; size?: 'md' | 'lg'; style?: object }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.outline,
        size === 'lg' && styles.outlineLg,
        { backgroundColor: theme.surface, borderColor: theme.separator },
        pressed && { opacity: 0.6 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[type.body, { color: theme.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

/** Pass to the next on call, with an optional reason (kept for the stats). */
export function PassSheet({ visible, onClose, onPass, loading }: { visible: boolean; onClose: () => void; onPass: (reason: PassReason | null) => void; loading?: boolean }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Pass to next on call" subtitle="It goes to the next person right away. A reason is optional." dismissLabel="Cancel">
      <View style={{ gap: space.sm }}>
        {PASS_REASONS.map((r) => (
          <OutlineButton key={r.value} label={r.label} disabled={loading} onPress={() => onPass(r.value)} />
        ))}
        <Button label="Pass without a reason" variant="plain" loading={loading} onPress={() => onPass(null)} />
      </View>
    </Sheet>
  );
}

/** Today: one red banner per open alert, above the on-call card. */
export function UrgentBanners({ alerts }: { alerts: OncallAlert[] }) {
  const theme = useTheme();
  if (!alerts.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      {alerts.map((a) => (
        <Pressable
          key={a.id}
          onPress={() => router.push(alertHref(a.id))}
          accessibilityRole="link"
          accessibilityLabel={`${bannerTitle(a)}. ${bannerLine(a)}`}
          style={({ pressed }) => [styles.banner, { backgroundColor: theme.red }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="warning" size={20} color="#FFFFFF" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.subhead, styles.bannerTitle]} numberOfLines={2}>
              {bannerTitle(a)}
            </Text>
            <Text style={[type.caption, styles.bannerLine]} numberOfLines={1}>
              {bannerLine(a)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </Pressable>
      ))}
    </View>
  );
}

/** S7's urgent card: title, the live countdown, inline Accept / Pass. Only for alerts with my pending offer. */
export function UrgentOfferCard({ alert }: { alert: OncallAlert }) {
  const theme = useTheme();
  const now = useNow();
  const accept = useAcceptAlert();
  const pass = usePassAlert();
  const [passing, setPassing] = useState(false);
  const expiresAt = alert.my_offer?.expires_at ?? alert.step_expires_at;

  const onAccept = () =>
    accept.mutate(alert.id, {
      onSuccess: () => {
        success();
        router.push(alertHref(alert.id));
      },
      onError: (e) => Alert.alert('Couldn’t accept', oncallAlertError(e).message),
    });

  const onPass = (reason: PassReason | null) =>
    pass.mutate(
      { id: alert.id, reason },
      {
        onSuccess: () => setPassing(false),
        onError: (e) => {
          setPassing(false);
          Alert.alert('Couldn’t pass', oncallAlertError(e).message);
        },
      },
    );

  return (
    <Card style={[styles.offer, { borderColor: theme.dangerSoft }]}>
      <View style={styles.offerHead}>
        <View style={[styles.offerIcon, { backgroundColor: theme.dangerSoft }]}>
          <Ionicons name="warning-outline" size={20} color={theme.red} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text onPress={() => router.push(alertHref(alert.id))} accessibilityRole="link" style={[type.headline, { color: theme.text }]}>
            {bannerTitle(alert)}
          </Text>
          {expiresAt ? (
            <Text style={[type.footnote, { color: theme.textSecondary }]} accessibilityLiveRegion="polite">
              {offerLine(alert, expiresAt, now)}
            </Text>
          ) : null}
          <View style={styles.offerActions}>
            <Button label="Accept" loading={accept.isPending} disabled={pass.isPending} onPress={onAccept} style={styles.small} />
            <OutlineButton label="Pass" disabled={accept.isPending || pass.isPending} onPress={() => setPassing(true)} style={styles.small} />
          </View>
        </View>
      </View>
      <PassSheet visible={passing} onClose={() => setPassing(false)} onPass={onPass} loading={pass.isPending} />
    </Card>
  );
}

/** A plain row for the alert screen's "Open the case" link. */
export function CaseLinkRow({ caseId, caseNumber }: { caseId: string; caseNumber: number }) {
  return (
    <Row
      title={`Open case #${caseNumber}`}
      icon="folder-open-outline"
      accessory="chevron"
      onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: caseId } })}
    />
  );
}

const styles = StyleSheet.create({
  line911: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.lg, padding: space.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  bannerTitle: { color: '#FFFFFF', fontWeight: '700' },
  bannerLine: { color: '#FFFFFF', opacity: 0.92 },
  offer: { borderWidth: 1 },
  offerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  offerIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  offerActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  small: { minHeight: 36, paddingHorizontal: space.lg },
  outline: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, minHeight: 44, paddingHorizontal: space.lg },
  outlineLg: { minHeight: 50 },
});
