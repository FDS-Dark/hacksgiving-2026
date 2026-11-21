import { router } from 'expo-router';

import { ResidentScreen } from '@/components/resident';
import { EmptyState, ErrorBanner, Group, Loading, Row } from '@/components/ui';
import { useVoiceReferrals } from '@/services/voice';

export default function ReferralHistoryScreen() {
  const referrals = useVoiceReferrals();

  return (
    <ResidentScreen
      title="Past referrals"
      refreshing={referrals.isRefetching}
      onRefresh={() => referrals.refetch()}
    >
      {referrals.isPending ? <Loading label="Loading referrals" /> : null}
      {referrals.error ? <ErrorBanner error={referrals.error} onRetry={() => referrals.refetch()} /> : null}
      {referrals.data?.length ? (
        <Group footer="These are reviewed resources shared during phone calls connected to your account.">
          {referrals.data.map((item) => (
            <Row
              key={item.id}
              title={item.resource_name}
              subtitle={item.resource_description}
              detail={new Date(item.created_at).toLocaleDateString()}
              accessory="chevron"
              onPress={() => router.push({ pathname: '/referrals/[id]', params: { id: item.id } })}
            />
          ))}
        </Group>
      ) : referrals.data ? (
        <EmptyState
          icon="link-outline"
          title="No referrals yet"
          body="Resources accepted during a connected phone call will appear here."
        />
      ) : null}
    </ResidentScreen>
  );
}
