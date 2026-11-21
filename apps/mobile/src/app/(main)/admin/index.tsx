import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Platform, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Group, Notice, Row, tap, type IconName } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { PARTNERS, STAFF } from '@/lib/directory';
import { followUpDue, isOpen, isOverdue } from '@/lib/requests';
import { REQUIRED_MODULES, TRAINING_MODULES } from '@/lib/training';
import { SERIF, radius, space, useTheme } from '@/theme/tokens';

/*
 * Sample data until the admin API exists. Replace each list with a query.
 */
const STATS: { icon: IconName; number: string; label: string }[] = [
  { icon: 'people-outline', number: '128', label: 'Active workers' },
  { icon: 'school-outline', number: '82%', label: 'Field-ready' },
  { icon: 'briefcase-outline', number: '34', label: 'Open opportunities' },
  { icon: 'business-outline', number: '17', label: 'Partner orgs' },
];

/**
 * Tools for ComForce staff and partner organizations: workers, training,
 * partners, and the content residents see. Opened from Account.
 */
export default function AdminScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const statColumns = width >= 700 ? 4 : 2;
  const { adminMode, setAdminMode, postings, requests, posts } = useAdmin();
  const openRequests = requests.filter(isOpen);
  const overdue = openRequests.filter((r) => isOverdue(r)).length;
  const urgent = openRequests.filter((r) => r.priority === 'urgent').length;
  const followUps = requests.filter(followUpDue).length;
  const openOpportunities = () => {
    setAdminMode(true);
    router.navigate('/opportunities');
  };

  return (
    <Page contentStyle={{ maxWidth: 900 }}>
      <SectionHeading title="Admin" kicker="For ComForce staff and partner organizations." />

      <Notice icon="construct-outline" tone="warning">
        Preview: anyone can open this page for now, and the numbers are sample data. It will be limited to ComForce staff and partners.
      </Notice>

      <Group header="Workspace" headerIcon="briefcase-outline">
        <Row
          title="Business insights"
          subtitle="Actions to take, budget, funding, volunteers, partners"
          icon="bulb-outline"
          accessory="chevron"
          onPress={() => router.navigate('/admin/insights')}
        />
        <Row
          title="Assistance requests"
          subtitle={[
            `${openRequests.length} open`,
            urgent ? `${urgent} urgent` : '',
            overdue ? `${overdue} overdue` : '',
            followUps ? `${followUps} follow-ups due` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          icon="help-buoy-outline"
          detail={overdue ? 'Needs attention' : undefined}
          detailTint={overdue ? theme.dangerSoft : undefined}
          detailColor={theme.danger}
          accessory="chevron"
          onPress={() => router.navigate('/admin/requests')}
        />
        <Row
          title="Rapid response & EMS"
          subtitle="Response times, EMS coordination, overdoses, call patterns"
          icon="pulse-outline"
          accessory="chevron"
          onPress={() => router.navigate('/admin/response')}
        />
        <Row
          title="Services"
          subtitle="Directory of services, usage, and partner relationships"
          icon="business-outline"
          accessory="chevron"
          onPress={() => router.navigate('/admin/services')}
        />
        <Row
          title="Info hub"
          subtitle={`${posts.length} posts: announcements, guides, contacts, forms`}
          icon="folder-open-outline"
          accessory="chevron"
          onPress={() => router.navigate('/admin/info')}
        />
      </Group>

      <Group
        footer={
          adminMode
            ? 'Staff tools now show on regular pages, starting with Opportunities.'
            : 'Turn on to post and manage content from the regular pages.'
        }
      >
        <Row
          title="Admin mode"
          icon="key-outline"
          right={
            <Switch
              value={adminMode}
              onValueChange={(on) => {
                tap();
                setAdminMode(on);
              }}
              accessibilityLabel="Admin mode"
              trackColor={{ true: theme.accent, false: theme.separator }}
              thumbColor="#FFFFFF"
              {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
            />
          }
        />
      </Group>

      <View style={styles.stats}>
        {STATS.map((s) => (
          <View key={s.label} style={{ width: `${100 / statColumns}%`, padding: space.xs }}>
            <View style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
              <Ionicons name={s.icon} size={22} color={theme.accent} />
              <Text style={[styles.statNumber, { color: theme.text }]}>{s.number}</Text>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{s.label}</Text>
            </View>
          </View>
        ))}
      </View>

      <Group header="Training compliance" headerIcon="school-outline" footer={`${REQUIRED_MODULES.length} of ${TRAINING_MODULES.length} modules are required before a first shift.`}>
        {STAFF.map((w) => {
          const complete = w.trainingDone === TRAINING_MODULES.length;
          const started = w.trainingDone > 0;
          return (
            <Row
              key={w.name}
              title={w.name}
              subtitle={w.role}
              detail={complete ? 'Complete' : `${w.trainingDone}/${TRAINING_MODULES.length}`}
              detailTint={complete ? theme.accentSoft : started ? theme.fill : theme.warningSoft}
              detailColor={complete ? theme.accent : started ? theme.textSecondary : theme.soon}
            />
          );
        })}
        <Row title="Preview the worker course" icon="eye-outline" tone="accent" accessory="chevron" onPress={() => router.navigate('/training')} />
      </Group>

      <Group header="Partners" headerIcon="business-outline">
        {PARTNERS.map((p) => (
          <Row
            key={p.name}
            title={p.name}
            subtitle={p.kind}
            detail={p.status}
            detailTint={p.status === 'Active' ? theme.accentSoft : theme.warningSoft}
            detailColor={p.status === 'Active' ? theme.accent : theme.soon}
          />
        ))}
        <Row title="Invite a partner" icon="person-add-outline" tone="accent" detail="Coming soon" />
      </Group>

      <Group header="Manage content" headerIcon="create-outline" footer="Editing for resources, locations, and training is coming soon.">
        <Row
          title="Opportunities"
          subtitle="Post jobs and volunteer openings"
          icon="briefcase-outline"
          detail={`${postings.length}`}
          accessory="chevron"
          onPress={openOpportunities}
        />
        <Row title="Resources" subtitle="Food, shelter, transportation, crisis" icon="library-outline" detail="Coming soon" />
        <Row title="Locations" subtitle="ComForce sites and partner services" icon="location-outline" detail="Coming soon" />
        <Row title="Training modules" subtitle={`${TRAINING_MODULES.length} modules`} icon="school-outline" detail="Coming soon" />
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  stat: { gap: space.xs, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  statNumber: { fontFamily: SERIF, fontSize: 32, lineHeight: 36, fontWeight: '900', marginTop: space.xs },
  statLabel: { fontSize: 14, fontWeight: '700' },
});
