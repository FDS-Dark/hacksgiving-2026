import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import { FindRequest, RequestList } from '@/components/RequestList';
import { BigButton, ResidentScreen } from '@/components/resident';
import { useAuth } from '@/lib/auth';
import { useResidentRequests } from '@/services/requests';
import { space } from '@/theme/tokens';

/**
 * My requests, signed out: the ones saved on this phone, and a way to open
 * one with its number and access code. Signed in, the Requests tab has them.
 */
export default function SavedRequestsScreen() {
  const signedIn = useAuth().status === 'signedIn';
  const list = useResidentRequests();
  if (signedIn) return <Redirect href="/requests" />;

  return (
    <ResidentScreen
      title="My requests"
      refreshing={list.isRefetching}
      onRefresh={list.refetch}
      footer={<BigButton label="Ask for help" onPress={() => router.replace('/help')} />}
    >
      <View style={{ gap: space.lg }}>
        <RequestList />
        <FindRequest />
      </View>
    </ResidentScreen>
  );
}
