import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, ErrorBanner, Field, Group, Notice, Row, success, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { ensurePermission, openSettings, usePushPermission } from '@/lib/push';
import { withKindMuted } from '@/lib/pushRules';
import { useCommunityAlerts, useSetCommunityAlerts } from '@/services/community';
import { useApiHealth } from '@/services/health';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/services/notifications';
import { useIsStaff } from '@/services/staff';
import { useMe } from '@/services/user';
import { useClaimVoiceHandoff, useVoiceFollowUps } from '@/services/voice';
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
    <Page refreshing={me.isRefetching} onRefresh={() => me.refetch()} contentStyle={{ maxWidth: 560, gap: space.lg }}>
      <ResidentHeader title="Me" />

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

      <Group header="Safety" footer="Quick exit is on every screen. It leaves the app at once and opens a weather site.">
        <Row title="Quick exit opens" icon="close-circle-outline" detail="A weather site" />
      </Group>

      {status === 'signedIn' ? <NotificationSettings /> : null}

      <PhoneCalls />

      <Group header="Your neighborhood">
        <Row title="Safety map" icon="map-outline" accessory="chevron" onPress={() => router.push('/safety')} />
        <Row title="Safety alerts" icon="notifications-outline" accessory="chevron" onPress={() => router.push('/alerts')} />
      </Group>

      <Group header="ComForce MKE">
        <Row title="Volunteer and jobs" icon="heart-outline" accessory="chevron" onPress={() => router.push('/opportunities')} />
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
          subtitle="Serious weather in Milwaukee, like extreme cold. Off unless you turn it on."
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

/** Connect a call with the phone assistant to this account, and its follow-ups. */
function PhoneCalls() {
  const followUps = useVoiceFollowUps();
  const claim = useClaimVoiceHandoff();
  const [code, setCode] = useState('');
  const [callConnected, setCallConnected] = useState(false);

  const connect = () =>
    claim.mutate(
      { code: code.trim().toUpperCase() },
      {
        onSuccess: () => {
          setCode('');
          setCallConnected(true);
          success();
        },
      },
    );

  return (
    <>
      <Group header="Phone calls" footer="Ask the phone assistant for an app code. It works once, for 15 minutes. No phone number or transcript is saved.">
        <Row
          title="Call code"
          right={
            <Field
              value={code}
              onChangeText={(value) => {
                setCallConnected(false);
                setCode(value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8));
              }}
              placeholder="ABCD2345"
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Call handoff code"
              style={{ minWidth: 110, textAlign: 'center' }}
            />
          }
        />
        <Row title="Connect call" tone="accent" onPress={connect} disabled={code.length !== 8 || claim.isPending} />
        <Row
          title="Past referrals"
          subtitle="Recommendations and contact details from connected calls"
          icon="link-outline"
          accessory="chevron"
          onPress={() => router.push('/referrals/index')}
        />
        {followUps.data?.map((item) => (
          <Row
            key={item.id}
            title={item.need_category?.replaceAll('-', ' ') ?? 'Community support call'}
            subtitle={item.resources.length ? item.resources.join(', ') : 'No resource selected yet'}
            detail={item.urgency_tier ?? undefined}
          />
        ))}
      </Group>
      {callConnected ? (
        <Notice icon="checkmark-circle-outline">
          Call connected. Your follow-up appears below and under Safety alerts.
        </Notice>
      ) : null}
      {claim.error ? <ErrorBanner error={claim.error} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 20, fontWeight: '800' },
  meta: { fontSize: 13 },
});
