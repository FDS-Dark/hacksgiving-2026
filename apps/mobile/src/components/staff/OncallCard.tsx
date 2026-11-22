/** The on-call switch Today (its Team group) and Me share. */
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Notice } from '@/components/ui';
import { ensurePermission, openSettings, usePushPermission } from '@/lib/push';
import { shiftError, useOncallNow, useToggleOncall } from '@/services/oncall';

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
