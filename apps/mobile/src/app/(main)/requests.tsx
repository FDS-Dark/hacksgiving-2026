import { router } from 'expo-router';

import { Page } from '@/components/Page';
import { RequestList } from '@/components/RequestList';
import { BigButton, ResidentHeader } from '@/components/resident';
import { useResidentRequests } from '@/services/requests';
import { space } from '@/theme/tokens';

/** Figma R1 "Requests" tab: open requests first with where each one stands; tap for the thread. */
export default function RequestsTab() {
  const list = useResidentRequests();
  return (
    <Page refreshing={list.isRefetching} onRefresh={list.refetch} contentStyle={{ maxWidth: 560, gap: space.lg }}>
      <ResidentHeader title="Requests" />
      <RequestList />
      <BigButton label="Ask for help" variant="outline" onPress={() => router.push('/help')} />
    </Page>
  );
}
