/**
 * Urgent escalation pieces shared by S7 (the urgent
 * offer card) and the Respond screen (/staff/alerts/[id]): a ticking clock,
 * the Call 911 button and the Pass reason sheet.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/staff/kit';
import { Button, Row, Sheet, success } from '@/components/ui';
import { callPhone } from '@/lib/phone';
import { bannerTitle, offerLine } from '@/lib/urgent';
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

/** A red Call 911 button. It dials only in production builds (lib/phone.ts); the app never calls on its own. */
export function Call911Button({ style }: { style?: object }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => callPhone('911')}
      accessibilityRole="button"
      accessibilityLabel="Call 911"
      style={({ pressed }) => [styles.call, { backgroundColor: theme.red }, pressed && { opacity: 0.7 }, style]}
    >
      <Ionicons name="call" size={18} color="#FFFFFF" />
      <Text style={[type.body, { color: '#FFFFFF', fontWeight: '700' }]}>Call 911</Text>
    </Pressable>
  );
}

/** "If anyone may be hurt or armed, call 911 first", with the button. */
export function Call911Line() {
  const theme = useTheme();
  return (
    <View style={[styles.line911, { backgroundColor: theme.dangerSoft }]}>
      <Ionicons name="warning-outline" size={18} color={theme.danger} />
      <Text style={[type.footnote, { color: theme.danger, fontWeight: '600', flex: 1 }]}>If anyone may be hurt or armed, call 911 first.</Text>
      <Call911Button style={styles.call911Small} />
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
  call: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderRadius: radius.lg, minHeight: 50, paddingHorizontal: space.lg },
  call911Small: { minHeight: 36, paddingHorizontal: space.md },
  line911: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.lg, padding: space.md },
  offer: { borderWidth: 1 },
  offerHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  offerIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  offerActions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  small: { minHeight: 36, paddingHorizontal: space.lg },
  outline: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, minHeight: 44, paddingHorizontal: space.lg },
  outlineLg: { minHeight: 50 },
});
