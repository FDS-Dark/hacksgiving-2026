import { Button, ErrorBanner, Group, Header, Loading, Notice, Row, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useApiHealth } from '@/services/health';
import { useMe } from '@/services/user';

/** The signed-in user, as the API sees them. A starting point for real screens. */
export default function HomeScreen() {
  const { signOut, mode } = useAuth();
  const health = useApiHealth();
  const me = useMe();

  const refresh = () => {
    health.refetch();
    me.refetch();
  };

  return (
    <Screen refreshing={me.isRefetching} onRefresh={refresh}>
      <Header title="Hacksgiving" subtitle={me.data?.display_name ? `Hi, ${me.data.display_name}.` : null} />

      {health.error ? <Notice icon="cloud-offline-outline">Can’t reach the API right now.</Notice> : null}
      {me.error ? <ErrorBanner error={me.error} onRetry={refresh} /> : null}

      {me.isPending ? (
        <Loading />
      ) : me.data ? (
        <Group header="Account">
          <Row title="Name" detail={me.data.display_name ?? 'Not set'} />
          <Row title="Time zone" detail={me.data.timezone} />
          <Row title="Signed in with" detail={mode === 'dev' ? 'Dev token' : 'Auth0'} />
        </Group>
      ) : null}

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Screen>
  );
}
