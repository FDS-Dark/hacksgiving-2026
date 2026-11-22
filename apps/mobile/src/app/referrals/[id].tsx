import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import { ResidentScreen } from '@/components/resident';
import { Button, ErrorBanner, Group, Loading, Notice, Row } from '@/components/ui';
import { followUpLabel, placeStatus } from '@/lib/phoneCalls';
import { useRecordVoiceOutcome, useVoiceReferral } from '@/services/voice';

export default function ReferralDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const referral = useVoiceReferral(id);
  const outcome = useRecordVoiceOutcome(id);
  const item = referral.data;

  return (
    <ResidentScreen title="Place ComForce recommended" refreshing={referral.isRefetching} onRefresh={() => referral.refetch()}>
      {referral.isPending ? <Loading label="Loading this place" /> : null}
      {referral.error ? <ErrorBanner error={referral.error} onRetry={() => referral.refetch()} /> : null}
      {item ? (
        <>
          <Group header={item.resource_name} footer={item.resource_description}>
            <Row title="Service area" detail={item.service_area} />
            {item.hours_label ? <Row title="Hours" detail={item.hours_label} /> : null}
            <Row title="Where it stands" detail={placeStatus(item)} />
            {/* Who delivered the help: the organization only, never a staff member's name. */}
            {item.outcome_status === 'completed' ? (
              <Row title={`Help from ${item.resource_name}`} icon="checkmark-circle-outline" accessibilityLabel={`Help from ${item.resource_name}`} />
            ) : null}
            {followUpLabel(item) ? <Row title="Check-in" subtitle={followUpLabel(item)} /> : null}
            <Row title="Languages" detail={item.languages.join(', ')} />
          </Group>
          {item.phone_e164 ? (
            <Button
              label={`Call ${item.resource_name}`}
              icon="call-outline"
              size="lg"
              onPress={() => Linking.openURL(`tel:${item.phone_e164}`)}
            />
          ) : (
            <Notice icon="information-circle-outline">This place has no public phone number.</Notice>
          )}
          {item.follow_up_status === 'pending' || item.follow_up_status === 'needs_help' ? (
            <Group header="Did this connection help?" footer="Your answer goes to ComForce. We never share a recording of your call.">
              <Row
                title="Yes, I reached help"
                icon="checkmark-circle-outline"
                accessory="chevron"
                onPress={() => outcome.mutate({ status: 'completed', reason_code: null })}
              />
              <Row
                title="I still need help"
                icon="help-circle-outline"
                accessory="chevron"
                onPress={() => outcome.mutate({ status: 'follow_up_needed', reason_code: 'resident_requested_follow_up' })}
              />
            </Group>
          ) : null}
          {outcome.error ? <ErrorBanner error={outcome.error} /> : null}
        </>
      ) : null}
    </ResidentScreen>
  );
}
