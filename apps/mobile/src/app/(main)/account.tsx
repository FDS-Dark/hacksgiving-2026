import { router } from 'expo-router';

import { Button, ErrorBanner, Group, Loading, Notice, Row } from '@/components/ui';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { useAuth } from '@/lib/auth';
import { useApiHealth } from '@/services/health';
import { useMe } from '@/services/user';

/** The signed-in user, as the API sees them, and sign out. Opened from the header's account button. */
export default function AccountScreen() {
  const { signOut, mode } = useAuth();
  const health = useApiHealth();
  const me = useMe();

  const refresh = () => {
    health.refetch();
    me.refetch();
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

      <Group header="Work">
        <Row
          title="Training"
          subtitle="Courses for workers and volunteers"
          icon="school-outline"
          accessory="chevron"
          onPress={() => router.navigate('/training')}
        />
        <Row
          title="Admin"
          subtitle="For ComForce staff and partners"
          icon="settings-outline"
          accessory="chevron"
          onPress={() => router.navigate('/admin')}
        />
      </Group>

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Page>
  );
}
