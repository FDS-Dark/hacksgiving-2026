import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { toApiError } from '@/api/client';

import { Page } from '@/components/Page';
import { Button, ErrorBanner, Group, Notice, Row, Toggle } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/staff/kit';
import { PushBlockedNotice, useOncallSwitch } from '@/components/staff/OncallCard';
import { useAuth } from '@/lib/auth';
import { hours } from '@/lib/format';
import { ensurePermission, openSettings, usePushPermission, type PushPermission } from '@/lib/push';
import { untilLabel } from '@/lib/oncall';
import { ROLE_LABEL } from '@/lib/staff';
import { showCommunityView } from '@/lib/viewMode';
import { useInsights } from '@/services/cases';
import { useNotificationPreferences, useSendTestNotification, useUpdateNotificationPreferences } from '@/services/notifications';
import { useStaffStatus, useWorkers } from '@/services/staff';
import { useStaffVoiceCalls } from '@/services/voice';
import { space, useTheme } from '@/theme/tokens';

/** Figma "Staff · Me": who you are, the admin tools (Manage), and switching to the community view. */
export default function StaffMeScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const me = useStaffStatus();
  const workers = useWorkers();
  const insights = useInsights();
  const calls = useStaffVoiceCalls();
  const oncall = useOncallSwitch();
  const prefs = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const myShift = oncall.now.data?.me.shift;
  const urgent = updatePrefs.isPending ? !!updatePrefs.variables?.urgent_when_off_call : !!prefs.data?.urgent_when_off_call;

  const count = workers.data?.length;
  const avg = insights.data?.stats.avg_resolution_hours;

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.profile}>
        <Avatar name={me.data?.display_name} size={56} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {me.data?.display_name ?? 'ComForce staff'}
          </Text>
          {me.data ? <Badge label={ROLE_LABEL[me.data.role]} color={theme.accent} /> : null}
        </View>
      </View>

      <Group header="Shift" footer="Also alert me about urgent cases when I’m off call.">
        <Row
          title="On call"
          icon="time-outline"
          detail={oncall.on && myShift && !oncall.busy ? untilLabel(myShift) : undefined}
          right={<Toggle value={oncall.on} onChange={oncall.set} disabled={oncall.busy || !oncall.now.data} label="On call" />}
        />
        <Row
          title="Urgent alerts"
          icon="notifications-outline"
          right={
            <Toggle
              value={urgent}
              onChange={(next) => updatePrefs.mutate({ urgent_when_off_call: next })}
              disabled={updatePrefs.isPending || !prefs.data}
              label="Urgent alerts when off call"
            />
          }
        />
      </Group>
      {oncall.error ? <ErrorBanner error={oncall.error} /> : null}
      {oncall.pushBlocked ? <PushBlockedNotice /> : null}
      {updatePrefs.error ? <ErrorBanner error={updatePrefs.error} /> : null}

      <PushSettings />

      <Group header="Manage">
        <Row
          title="Team & roles"
          icon="people-outline"
          detail={count === undefined ? undefined : `${count} worker${count === 1 ? '' : 's'}`}
          accessory="chevron"
          onPress={() => router.push('/staff/team')}
        />
        <Row
          title="On-call schedule"
          icon="calendar-outline"
          accessory="chevron"
          onPress={() => router.push('/staff/oncall')}
        />
        <Row
          title="Insights"
          icon="bar-chart-outline"
          detail={avg === undefined ? undefined : `${hours(avg)} avg`}
          accessory="chevron"
          onPress={() => router.push('/staff/insights')}
        />
        <Row
          title="AI phone calls"
          subtitle="Privacy-safe routing outcomes and referrals"
          icon="call-outline"
          detail={calls.data === undefined ? undefined : String(calls.data.length)}
          accessory="chevron"
          onPress={() => router.push('/staff/calls/index')}
        />
        <Row
          title="Volunteer & job opportunities"
          icon="briefcase-outline"
          accessory="chevron"
          onPress={() => router.push('/staff/opportunities')}
        />
      </Group>

      <Group>
        <Row title="Switch to community view" icon="swap-horizontal-outline" accessory="chevron" onPress={showCommunityView} />
      </Group>

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Page>
  );
}

const PERMISSION_LABEL: Record<PushPermission, string> = {
  on: 'On',
  off: 'Off',
  blocked: 'Not allowed',
  unsupported: 'Unavailable',
};

/** This phone's notification permission, and a test push to check the whole path. */
function PushSettings() {
  const permission = usePushPermission();
  const test = useSendTestNotification();
  const state = permission.state;
  const rateLimited = test.error ? toApiError(test.error).status === 429 : false;
  // Never asked: ask here. Refused: only Settings can turn it back on.
  const onPress = state === 'off' ? () => void ensurePermission('staff') : state === 'blocked' ? openSettings : undefined;

  return (
    <>
      <Group header="Notifications" footer={state === 'unsupported' ? 'Push needs the installed app; it doesn’t work in Expo Go. The bell still shows everything.' : undefined}>
        <Row
          title="Notifications"
          icon="phone-portrait-outline"
          detail={state ? PERMISSION_LABEL[state] : undefined}
          accessory={onPress ? 'chevron' : undefined}
          onPress={onPress}
        />
        <Row
          title="Send a test notification"
          icon="paper-plane-outline"
          tone="accent"
          onPress={() => test.mutate()}
          disabled={test.isPending}
        />
      </Group>
      {test.isSuccess ? <Notice icon="checkmark-circle-outline">Sent. It should arrive in a few seconds.</Notice> : null}
      {rateLimited ? (
        <Notice icon="time-outline" tone="warning">
          You’ve sent a few tests already. Try again in a few minutes.
        </Notice>
      ) : test.error ? (
        <ErrorBanner error={test.error} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 22, fontWeight: '800' },
});
