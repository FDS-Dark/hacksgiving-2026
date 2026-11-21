import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import { ResidentScreen } from '@/components/resident';
import { Button, ErrorBanner, Group, Loading, Notice, Row } from '@/components/ui';
import { useVoiceReferral } from '@/services/voice';

export default function ReferralDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const referral = useVoiceReferral(id);
  const item = referral.data;

  return (
    <ResidentScreen title="Referral details" refreshing={referral.isRefetching} onRefresh={() => referral.refetch()}>
      {referral.isPending ? <Loading label="Loading referral" /> : null}
      {referral.error ? <ErrorBanner error={referral.error} onRetry={() => referral.refetch()} /> : null}
      {item ? (
        <>
          <Group header={item.resource_name} footer={item.resource_description}>
            <Row title="Service area" detail={item.service_area} />
            {item.hours_label ? <Row title="Hours" detail={item.hours_label} /> : null}
            <Row title="Referral status" detail={item.outcome_status ?? item.status} />
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
            <Notice icon="information-circle-outline">This reviewed resource does not publish a phone number.</Notice>
          )}
        </>
      ) : null}
    </ResidentScreen>
  );
}
