import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Card, ResidentScreen } from '@/components/resident';
import { Button, EmptyState, ErrorBanner, Field, Group, Loading, Notice, Row, Txt, success } from '@/components/ui';
import { LINK_CALL_REQUEST, callHistory, followUpLabel, placeStatus, readable } from '@/lib/phoneCalls';
import { useSendRequest } from '@/services/requests';
import { useClaimVoiceHandoff, useVoiceFollowUps, useVoiceReferrals } from '@/services/voice';
import { space } from '@/theme/tokens';

/**
 * Me > Phone calls: the one history of a resident's calls with the ComForce
 * phone assistant. Link a call with its phone-call code (or ask ComForce to
 * link it), then each call with the places ComForce recommended on it.
 */
export default function PhoneCallsScreen() {
  const calls = useVoiceFollowUps();
  const places = useVoiceReferrals();
  const loading = calls.isPending || places.isPending;
  const failed = calls.error ?? places.error;
  const history = calls.data && places.data ? callHistory(calls.data, places.data) : null;
  const refetch = () => {
    calls.refetch();
    places.refetch();
  };

  return (
    <ResidentScreen title="Phone calls" refreshing={calls.isRefetching || places.isRefetching} onRefresh={refetch}>
      <Txt variant="subhead" tone="secondary">
        Places and follow-ups from your calls.
      </Txt>

      <LinkCall />

      {loading ? (
        <Loading label="Loading your calls" />
      ) : !history ? (
        <ErrorBanner error={failed} onRetry={refetch} />
      ) : history.length === 0 ? (
        <EmptyState icon="call-outline" title="No calls linked yet" body="Link a call with its phone-call code. Places ComForce recommended on it will show here." />
      ) : (
        <>
          {failed ? <ErrorBanner error={failed} onRetry={refetch} /> : null}
          {history.map((call) => (
            <Group key={call.callId} header={`${call.need} · ${new Date(call.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}>
              {call.places.length ? (
                call.places.map((item) => (
                  <Row
                    key={item.id}
                    title={readable(item.resource_category) ?? item.resource_name}
                    // "Help from <the place>": where feat/track-gaps' delivered-by organization goes.
                    subtitle={[`Help from ${item.resource_name}`, placeStatus(item), followUpLabel(item)].filter(Boolean).join(' · ')}
                    accessibilityHint="Opens the place ComForce recommended"
                    accessory="chevron"
                    onPress={() => router.push({ pathname: '/referrals/[id]', params: { id: item.id } })}
                  />
                ))
              ) : call.names.length ? (
                call.names.map((name) => <Row key={name} title={name} subtitle="Place ComForce recommended" />)
              ) : (
                <Row title="No places recommended on this call" subtitle="ComForce may still follow up with you." />
              )}
            </Group>
          ))}
        </>
      )}
    </ResidentScreen>
  );
}

/** Enter a phone-call code, or ask ComForce to link the call when there's none. */
function LinkCall() {
  const claim = useClaimVoiceHandoff();
  const [code, setCode] = useState('');
  const [linked, setLinked] = useState(false);
  const [noCode, setNoCode] = useState(false);

  const connect = () =>
    claim.mutate(
      { code: code.trim().toUpperCase() },
      {
        onSuccess: () => {
          setCode('');
          setLinked(true);
          success();
        },
      },
    );

  return (
    <Card style={{ gap: space.md }}>
      <Field
        label="Phone-call code"
        value={code}
        onChangeText={(value) => {
          setLinked(false);
          setCode(value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8));
        }}
        placeholder="ABCD2345"
        autoCapitalize="characters"
        autoCorrect={false}
        style={{ letterSpacing: 2 }}
      />
      <Txt variant="footnote" tone="secondary">
        During your call, ask for a code. Enter it here within 15 minutes. We don’t keep your phone number or what you said.
      </Txt>
      <Button label="Link this call" onPress={connect} loading={claim.isPending} disabled={code.length !== 8} />
      {linked ? <Notice icon="checkmark-circle-outline">Call linked. It shows below.</Notice> : null}
      {claim.error ? <ErrorBanner error={claim.error} /> : null}
      <Button label={noCode ? 'Hide' : 'I don’t have a code'} variant="plain" onPress={() => setNoCode((on) => !on)} />
      {noCode ? <NoCode /> : null}
    </Card>
  );
}

/** "I don't have a code": how to get a new one, or a normal request asking ComForce to link the call. */
function NoCode() {
  const send = useSendRequest();
  const result = send.data;
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="subhead">A code works once, for 15 minutes. To get a new one, call ComForce again and ask for a phone-call code.</Txt>
      <Txt variant="subhead" tone="secondary">
        Or ask ComForce to find your call and link it for you. A worker will reply in Requests.
      </Txt>
      {!result ? (
        <Button
          label="Ask ComForce to link my call"
          variant="tinted"
          loading={send.isPending}
          onPress={() => send.mutate({ ...LINK_CALL_REQUEST, category: 'other' })}
        />
      ) : 'queued' in result ? (
        <Notice icon="cloud-offline-outline">Saved on your phone. It will send when you’re back online.</Notice>
      ) : (
        <>
          <Notice icon="checkmark-circle-outline">Sent. ComForce will link your call and reply in Requests.</Notice>
          <Button
            label="See my request"
            variant="plain"
            onPress={() => router.push({ pathname: '/help/request/[id]', params: { id: result.request.id } })}
          />
        </>
      )}
      {send.error ? <ErrorBanner error={send.error} /> : null}
    </View>
  );
}
