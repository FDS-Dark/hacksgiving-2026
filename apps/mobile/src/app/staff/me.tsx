import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Page } from '@/components/Page';
import { Button, Group, Row } from '@/components/ui';
import { Avatar } from '@/components/Avatar';
import { Badge } from '@/components/staff/kit';
import { useAuth } from '@/lib/auth';
import { hours } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/staff';
import { showCommunityView } from '@/lib/viewMode';
import { useInsights } from '@/services/cases';
import { useStaffStatus, useWorkers } from '@/services/staff';
import { useStaffVoiceCalls } from '@/services/voice';
import { space, useTheme } from '@/theme/tokens';

/** Figma "Staff · Me": who you are, the admin tools (Manage), and switching to the community view. */
export default function StaffMeScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const me = useStaffStatus();
  const workers = useWorkers();
  const insights = useInsights();
  const calls = useStaffVoiceCalls();

  const count = workers.data?.length;
  const avg = insights.data?.stats.avg_resolution_hours;

  return (
    <Page contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <View style={styles.profile}>
        <Avatar name={me.data?.display_name} size={56} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
            {me.data?.display_name ?? 'ComForce staff'}
          </Text>
          {me.data ? <Badge label={ROLE_LABEL[me.data.role]} color={theme.accent} /> : null}
        </View>
      </View>

      <Group header="Manage">
        <Row
          title="Team & roles"
          icon="people-outline"
          detail={count === undefined ? undefined : `${count} worker${count === 1 ? '' : 's'}`}
          accessory="chevron"
          onPress={() => router.push('/staff/team')}
        />
        <Row
          title="Insights"
          icon="bar-chart-outline"
          detail={avg === undefined ? undefined : `${hours(avg)} avg`}
          accessory="chevron"
          onPress={() => router.push('/staff/insights')}
        />
        <Row
          title="AI phone calls"
          subtitle="Privacy-safe routing outcomes and referrals"
          icon="call-outline"
          detail={calls.data === undefined ? undefined : String(calls.data.length)}
          accessory="chevron"
          onPress={() => router.push('/staff/calls/index')}
        />
        <Row
          title="Volunteer & job opportunities"
          icon="briefcase-outline"
          accessory="chevron"
          onPress={() => router.push('/staff/opportunities')}
        />
      </Group>

      <Group>
        <Row title="Switch to community view" icon="swap-horizontal-outline" accessory="chevron" onPress={showCommunityView} />
      </Group>

      <Button label="Sign out" variant="plain" onPress={signOut} />
    </Page>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 22, fontWeight: '800' },
});
