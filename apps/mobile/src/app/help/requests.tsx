import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { RequestCard } from '@/components/HelpPanel';
import { BigButton, Card, Input, ResidentScreen } from '@/components/resident';
import { Button, ErrorBanner, Loading } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useFindRequest, useForgetRequest, useResidentRequests } from '@/services/requests';
import { useTheme } from '@/theme/tokens';

/** My requests: the account's and the ones saved on this phone, plus a
 *  way to open one with its number and access code. */
export default function MyRequestsScreen() {
  const theme = useTheme();
  const signedIn = useAuth().status === 'signedIn';
  const list = useResidentRequests();
  const forget = useForgetRequest();

  return (
    <ResidentScreen title="My requests" refreshing={list.isRefetching} onRefresh={list.refetch}>
      {list.error ? <ErrorBanner error={list.error} onRetry={list.refetch} /> : null}
      {list.isPending ? (
        <Loading />
      ) : list.requests.length ? (
        list.requests.map((r) => <RequestCard key={r.id} request={r} />)
      ) : (
        <Card style={{ gap: 12 }}>
          <Text style={{ fontSize: 15, color: theme.textSecondary }}>
            {signedIn ? 'You haven’t asked for help yet.' : 'No requests saved on this phone.'}
          </Text>
          <BigButton label="Get help now" onPress={() => router.replace('/help')} />
        </Card>
      )}

      {list.unavailable.map((r) => (
        <Card key={r.id}>
          <Text style={{ fontSize: 15, color: theme.text }}>Request #{r.number} can’t be opened right now.</Text>
          <Button label="Forget it on this phone" variant="plain" onPress={() => forget.mutate(r.id)} />
        </Card>
      ))}

      <FindRequest />
    </ResidentScreen>
  );
}

/** Open a request sent without an account, from its receipt. */
function FindRequest() {
  const theme = useTheme();
  const find = useFindRequest();
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const parsed = Number.parseInt(number.replace(/\D/g, ''), 10);
  const ready = parsed > 0 && code.replace(/[^a-z0-9]/gi, '').length >= 8;

  return (
    <Card style={{ gap: 12, marginTop: 8 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text }}>Have a reference number and code?</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 2 }}>
          <Input label="Reference #" value={number} onChangeText={setNumber} placeholder="1042" keyboardType="number-pad" maxLength={10} />
        </View>
        <View style={{ flex: 3 }}>
          <Input
            label="Access code"
            value={code}
            onChangeText={setCode}
            placeholder="K7QM-4XPA"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
        </View>
      </View>
      {find.error ? <ErrorBanner error={find.error} /> : null}
      <BigButton
        label="Open request"
        variant="outline"
        disabled={!ready}
        loading={find.isPending}
        onPress={() =>
          find.mutate({ number: parsed, code: code.trim() }, { onSuccess: (request) => router.push(`/help/request/${request.id}`) })
        }
      />
    </Card>
  );
}
