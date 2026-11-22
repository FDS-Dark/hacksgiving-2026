import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, usePathname } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '@/api/client';
import { TabBar, type TabItem } from '@/components/TabBar';
import { Button, ErrorBanner, Loading, Notice } from '@/components/ui';
import { Card } from '@/components/staff/kit';
import { showCommunityView } from '@/lib/viewMode';
import { useBootstrapStaff, useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/** Figma "App shell v2" staff tabs. Record (a Phantom debrief) sits raised in the middle; Team and Insights live under Me. */
const TABS: TabItem[] = [
  { label: 'Today', href: '/staff', icon: 'home-outline', iconActive: 'home', match: (p) => p === '/staff' || p.startsWith('/staff/notifications') || p.startsWith('/staff/alerts') || p.startsWith('/staff/tasks') },
  { label: 'Queue', href: '/staff/cases', icon: 'list-outline', iconActive: 'list', match: (p) => p.startsWith('/staff/cases') },
  { label: 'Record', push: '/staff/records/new', icon: 'mic-outline', iconActive: 'mic', raised: true, match: (p) => p.startsWith('/staff/records') },
  { label: 'Map', href: '/staff/map', icon: 'location-outline', iconActive: 'location', match: (p) => p.startsWith('/staff/map') },
  {
    label: 'Me',
    href: '/staff/me',
    icon: 'person-outline',
    iconActive: 'person',
    match: (p) =>
      p.startsWith('/staff/me') || p.startsWith('/staff/oncall') || p.startsWith('/staff/team') || p.startsWith('/staff/insights') || p.startsWith('/staff/opportunities') || p.startsWith('/staff/calls'),
  },
];

/**
 * The staff app: ComForce workers and admins only, full screen with its own
 * tab bar (no website header). Everyone else signed in gets the gate below.
 */
export default function StaffLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const status = useStaffStatus();
  const pathname = usePathname();
  // Flows with their own bottom bar (S5 composer, S6 New case, a new debrief) cover the tabs.
  const fullScreen = pathname === '/staff/cases/new' || pathname === '/staff/records/new' || pathname.endsWith('/messages');

  let body;
  if (status.isPending) body = <Loading label="Checking your staff access" />;
  else if (status.error) body = <Centered><ErrorBanner error={status.error} onRetry={() => status.refetch()} /></Centered>;
  else if (!status.data.is_worker) body = <StaffGate name={status.data.display_name} />;
  else {
    body = (
      <>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="cases/index" />
          <Stack.Screen name="cases/new" />
          <Stack.Screen name="cases/[id]/index" />
          <Stack.Screen name="cases/[id]/messages" />
          <Stack.Screen name="records/new" />
          <Stack.Screen name="records/[id]" />
          <Stack.Screen name="map" />
          <Stack.Screen name="me" />
          <Stack.Screen name="calls/index" />
          <Stack.Screen name="calls/[id]" />
          <Stack.Screen name="team" />
          <Stack.Screen name="insights" />
          <Stack.Screen name="opportunities" />
          <Stack.Screen name="oncall" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="alerts/[id]" />
          <Stack.Screen name="tasks" />
        </Stack>
        {fullScreen ? null : <TabBar tabs={TABS} />}
      </>
    );
  }

  return <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>{body}</View>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

/** For signed-in people who aren't staff (yet). */
function StaffGate({ name }: { name?: string | null }) {
  const theme = useTheme();
  const bootstrap = useBootstrapStaff();
  const taken = bootstrap.error && toApiError(bootstrap.error).status === 409;
  return (
    <Centered>
      <Card style={{ gap: space.lg }}>
        <Ionicons name="lock-closed-outline" size={28} color={theme.accent} />
        <Text style={[styles.gateTitle, { color: theme.text }]}>ComForce staff only</Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          This part of the app is for Community Task Force MKE staff. Ask a staff admin to add you under Me → Team & roles
          {name ? <>, and tell them you signed in as <Text style={{ fontWeight: '700', color: theme.text }}>{name}</Text></> : null}.
        </Text>
        {taken ? (
          <Notice icon="information-circle-outline">Staff are already set up here, so an admin needs to add you.</Notice>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.footnote, { color: theme.textSecondary }]}>
              Setting up a new deployment? The first person to claim it becomes its admin.
            </Text>
            <Button label="Claim staff admin" icon="key-outline" variant="tinted" loading={bootstrap.isPending} onPress={() => bootstrap.mutate()} />
          </View>
        )}
        {bootstrap.error && !taken ? <ErrorBanner error={bootstrap.error} /> : null}
        <Button label="Back home" variant="plain" onPress={showCommunityView} />
      </Card>
    </Centered>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, padding: space.lg, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 560, alignSelf: 'center' },
  gateTitle: { fontSize: 24, fontWeight: '800' },
});
