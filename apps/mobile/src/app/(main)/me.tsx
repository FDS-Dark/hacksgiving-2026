import { router } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, ErrorBanner, Group, Notice, Row, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ensurePermission, openSettings, usePushPermission } from '@/lib/push';
import { withKindMuted } from '@/lib/pushRules';
import { useCommunityAlerts, useSetCommunityAlerts } from '@/services/community';
import { useApiHealth } from '@/services/health';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/services/notifications';
import { useIsStaff } from '@/services/staff';
import { useMe } from '@/services/user';
import { useVoiceFollowUps } from '@/services/voice';
import { space, useTheme } from '@/theme/tokens';

const COMFORCE_SITE = 'https://comforcemilwaukee.com';

/** Figma R5 "Me (resident)": who you are, safety, phone calls, the neighborhood, ComForce, sign out. */
export default function MeTab() {
  const theme = useTheme();
  const { signOut, status } = useAuth();
  const health = useApiHealth();
  const me = useMe();
  const isStaff = useIsStaff();
  const since = me.data ? new Date(me.data.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null;

  return (
    <Page header={<ResidentHeader title="Me" />} refreshing={me.isRefetching} onRefresh={() => me.refetch()} contentStyle={{ maxWidth: 560, gap: space.lg }}>
      <View style={styles.profile}>
        <Avatar name={me.data?.display_name} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {me.data?.display_name ?? 'Your account'}
          </Text>
          {since ? <Text style={[styles.meta, { color: theme.textSecondary }]}>Member since {since}</Text> : null}
        </View>
      </View>

      {health.error ? <Notice icon="cloud-offline-outline">Can’t reach ComForce right now.</Notice> : null}
      {me.error ? <ErrorBanner error={me.error} onRetry={() => me.refetch()} /> : null}

      <PhoneCalls />

      <Group header="Safety" footer="Quick exit is at the top of every screen. It hides this app and opens weather.">
        <Row title="Quick exit" icon="close-circle-outline" detail="Opens weather" />
      </Group>

      {status === 'signedIn' ? <NotificationSettings /> : null}

      <Group header="ComForce MKE">
        <Row title="Jobs and programs" icon="briefcase-outline" accessory="chevron" onPress={() => router.push('/opportunities')} />
        <Row title="About ComForce" icon="information-circle-outline" accessory="chevron" onPress={() => Linking.openURL(COMFORCE_SITE)} />
      </Group>

      {isStaff ? (
        <Group>
          <Row title="Staff app" subtitle="Back to your queue" icon="briefcase-outline" tone="accent" accessory="chevron" onPress={() => router.replace('/staff')} />
        </Group>
      ) : null}

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Page>
  );
}

/** R5 "Notifications": replies and updates on requests (`request_update`).
 *  No lock-screen text switch: a resident push never carries message text. */
function NotificationSettings() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const community = useCommunityAlerts();
  const setCommunity = useSetCommunityAlerts();
  const permission = usePushPermission();
  const muted = (update.isPending ? update.variables?.muted_kinds : undefined) ?? prefs.data?.muted_kinds ?? [];
  const on = !muted.includes('request_update');
  const blocked = permission.state === 'blocked';

  return (
    <>
      <Group
        header="Notifications"
        footer={
          blocked
            ? 'Notifications are off for ComForce in Settings, so nothing reaches your phone.'
            : 'We tell you when ComForce answers or your request changes. Message text never shows on your lock screen.'
        }
      >
        <Row
          title="Replies and updates"
          icon="chatbubble-outline"
          right={
            <Toggle
              value={on}
              onChange={(next) => {
                if (!prefs.data) return;
                update.mutate({ muted_kinds: withKindMuted(prefs.data.muted_kinds, 'request_update', !next) });
                // Turning it on after "Not now" on R6 is the moment to ask again.
                if (next && permission.state === 'off') void ensurePermission('resident');
              }}
              disabled={update.isPending || !prefs.data}
              label="Replies and updates"
            />
          }
        />
        <Row
          title="Community alerts"
          subtitle="Milwaukee severe-weather alerts. Off unless you turn it on."
          icon="cloudy-outline"
          right={
            <Toggle
              value={(setCommunity.isPending ? setCommunity.variables : community.data?.subscribed) ?? false}
              onChange={(next) => {
                setCommunity.mutate(next);
                if (next && permission.state === 'off') void ensurePermission('resident');
              }}
              disabled={setCommunity.isPending || !community.data}
              label="Community alerts"
            />
          }
        />
        {blocked ? <Row title="Open Settings" icon="settings-outline" accessory="chevron" onPress={openSettings} /> : null}
      </Group>
      {update.error ? <ErrorBanner error={update.error} /> : null}
      {setCommunity.error ? <ErrorBanner error={setCommunity.error} /> : null}
    </>
  );
}

/** Me > Phone calls: one row into the call history (/referrals), with how many calls are linked. */
function PhoneCalls() {
  const calls = useVoiceFollowUps();
  const count = calls.data?.length;
  return (
    <Group>
      <Row
        title="Phone calls"
        subtitle="Places and follow-ups from your calls. Link a call with its phone-call code."
        icon="call-outline"
        detail={count ? String(count) : undefined}
        accessibilityLabel={count ? `Phone calls, ${count} linked` : 'Phone calls'}
        accessory="chevron"
        onPress={() => router.push('/referrals')}
      />
    </Group>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 20, fontWeight: '800' },
  meta: { fontSize: 13 },
});
