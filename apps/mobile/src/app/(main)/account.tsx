import { useState } from 'react';

import { Button, ErrorBanner, Field, Group, Loading, Notice, Row, success } from '@/components/ui';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { useAuth } from '@/lib/auth';
import { useApiHealth } from '@/services/health';
import { useClaimVoiceHandoff, useMe, useVoiceFollowUps } from '@/services/user';

/** The signed-in user, as the API sees them, and sign out. Opened from the header's account button. */
export default function AccountScreen() {
  const { signOut, mode } = useAuth();
  const health = useApiHealth();
  const me = useMe();
  const followUps = useVoiceFollowUps();
  const claim = useClaimVoiceHandoff();
  const [callCode, setCallCode] = useState('');

  const refresh = () => {
    health.refetch();
    me.refetch();
    followUps.refetch();
  };

  const connectCall = () => {
    claim.mutate(
      { code: callCode.trim().toUpperCase() },
      {
        onSuccess: () => {
          setCallCode('');
          success();
        },
      },
    );
  };

  return (
    <Page refreshing={me.isRefetching} onRefresh={refresh} contentStyle={{ maxWidth: 640 }}>
      <SectionHeading title="Account" kicker={me.data?.display_name ? `Hi, ${me.data.display_name}.` : undefined} />

      {health.error ? <Notice icon="cloud-offline-outline">Can’t reach the API right now.</Notice> : null}
      {me.error ? <ErrorBanner error={me.error} onRetry={refresh} /> : null}

      {me.isPending ? (
        <Loading />
      ) : me.data ? (
        <Group header="Profile">
          <Row title="Name" detail={me.data.display_name ?? 'Not set'} />
          <Row title="Time zone" detail={me.data.timezone} />
          <Row title="Signed in with" detail={mode === 'dev' ? 'Dev token' : 'Auth0'} />
        </Group>
      ) : null}

      <Group
        header="Connect a phone call"
        footer="Ask the phone assistant for an app handoff code. It expires after 15 minutes and can be used once."
      >
        <Row
          title="One-time call code"
          subtitle="No phone number or transcript is saved."
          right={
            <Field
              value={callCode}
              onChangeText={(value) => setCallCode(value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8))}
              placeholder="ABCD2345"
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Call handoff code"
              style={{ minWidth: 110, textAlign: 'center' }}
            />
          }
        />
        <Row
          title="Connect call"
          subtitle="Add its resources and follow-ups to this account."
          tone="accent"
          onPress={connectCall}
          disabled={callCode.length !== 8 || claim.isPending}
        />
      </Group>

      {claim.error ? <ErrorBanner error={claim.error} /> : null}

      <Group header="Call follow-ups" footer="Only structured outcomes and approved resource names appear here.">
        {followUps.data?.length ? (
          followUps.data.map((item) => (
            <Row
              key={item.id}
              title={item.need_category?.replaceAll('-', ' ') ?? 'Community support call'}
              subtitle={item.resources.length ? item.resources.join(', ') : 'No resource selected yet'}
              detail={item.urgency_tier ?? undefined}
            />
          ))
        ) : (
          <Row title="No connected calls" subtitle="Your claimed call follow-ups will appear here." />
        )}
      </Group>

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Page>
  );
}
