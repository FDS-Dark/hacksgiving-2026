/** Today's "You're on call" card (Figma 26:122), and the switch it shares with Me. */
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/staff/kit';
import { Button, ErrorBanner, Notice, Toggle } from '@/components/ui';
import { oncallSubtitle, oncallTitle } from '@/lib/oncall';
import { ensurePermission, openSettings, usePushPermission } from '@/lib/push';
import { shiftError, useOncallNow, useToggleOncall } from '@/services/oncall';
import { type, useTheme } from '@/theme/tokens';

/**
 * Whether I'm on call, and flipping it. While a flip is in flight the switch
 * shows where it's going. Going on call is when staff are asked for
 * notifications (alongside the flip, never blocking it); `pushBlocked` says
 * urgent alerts can't reach this phone while on call.
 */
export function useOncallSwitch() {
  const now = useOncallNow();
  const toggle = useToggleOncall();
  const permission = usePushPermission();
  const pending = toggle.isPending ? toggle.variables?.on : undefined;
  const on = pending ?? now.data?.me.on_call ?? false;
  return {
    now,
    on,
    busy: toggle.isPending,
    error: toggle.error ? shiftError(toggle.error) : null,
    pushBlocked: on && permission.state === 'blocked',
    set: (next: boolean) => {
      const wasOn = now.data?.me.on_call ?? false;
      // Going off call writes a shift handoff brief for the next person: show it.
      toggle.mutate({ on: next }, { onSuccess: () => (wasOn && !next ? router.push('/staff/handoffs') : undefined) });
      if (next) void ensurePermission('staff');
    },
  };
}

/** Shown while on call with notifications refused. */
export function PushBlockedNotice() {
  return (
    <View style={{ gap: 4 }}>
      <Notice icon="notifications-off-outline" tone="warning">
        Notifications are off for this app, so urgent alerts can’t reach your phone while you’re on call.
      </Notice>
      <Button label="Open Settings" variant="plain" onPress={openSettings} />
    </View>
  );
}

/** Hidden until /oncall/now answers, so a missing or failing endpoint never blocks Today. */
export function OncallCard() {
  const theme = useTheme();
  const oncall = useOncallSwitch();
  const data = oncall.now.data;
  if (!data) return null;
  return (
    <View style={{ gap: 8 }}>
      <Card style={styles.card}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[type.headline, { color: theme.text, fontWeight: '700' }]}>
            {oncallTitle(data)}
          </Text>
          <Text style={[type.subhead, { color: theme.textSecondary }]}>{oncallSubtitle(data)}</Text>
        </View>
        <Toggle value={oncall.on} onChange={oncall.set} disabled={oncall.busy} label="On call" />
      </Card>
      {oncall.error ? <ErrorBanner error={oncall.error} /> : null}
      {oncall.pushBlocked ? <PushBlockedNotice /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
});
