import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { Role } from '@/api/types';
import { Page } from '@/components/Page';
import { ErrorBanner, Group, Loading, Notice, Row } from '@/components/ui';
import { Card, CardTitle, ChoiceRow, ROLE_LABEL, timeAgo } from '@/components/worker/kit';
import { PARTNERS, STAFF } from '@/lib/directory';
import { REQUIRED_MODULES, TRAINING_MODULES } from '@/lib/training';
import { useSetRole, useStaffStatus, useUsers, useWorkers } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

const ROLES = ['member', 'worker', 'admin'] as const satisfies readonly Role[];

/** Who is on the team and their open case load; admins also manage access. */
export default function TeamScreen() {
  const theme = useTheme();
  const me = useStaffStatus();
  const workers = useWorkers();
  const isAdmin = !!me.data?.is_admin;
  const users = useUsers(isAdmin);
  const setRole = useSetRole();

  return (
    <Page refreshing={workers.isRefetching} onRefresh={() => { workers.refetch(); users.refetch(); }} contentStyle={{ maxWidth: 900 }}>
      <Card>
        <CardTitle title="Workers" icon="people-outline" />
        {workers.isPending ? <Loading /> : workers.error ? <ErrorBanner error={workers.error} /> : workers.data.map((w) => (
          <View key={w.id} style={[styles.row, { borderColor: theme.separator }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>
                {w.display_name ?? 'Unnamed'}{w.id === me.data?.id ? ' (you)' : ''}
              </Text>
              <Text style={[type.caption, { color: theme.textSecondary }]}>{ROLE_LABEL[w.role]}</Text>
            </View>
            <Text style={[type.subhead, { color: theme.text }]}>{w.open_cases} open case{w.open_cases === 1 ? '' : 's'}</Text>
          </View>
        ))}
      </Card>

      {isAdmin ? (
        <Card>
          <CardTitle title="Access" icon="key-outline" />
          <Text style={[type.footnote, { color: theme.textSecondary }]}>
            Everyone who has signed in to Hacksgiving. Make ComForce staff workers; admins can also manage this list.
          </Text>
          {setRole.error ? <ErrorBanner error={setRole.error} /> : null}
          {users.isPending ? <Loading /> : users.error ? <ErrorBanner error={users.error} /> : users.data.map((u) => (
            <View key={u.id} style={[styles.row, { borderColor: theme.separator, flexWrap: 'wrap' }]}>
              <View style={{ flex: 1, minWidth: 180 }}>
                <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>{u.display_name ?? 'Unnamed user'}</Text>
                <Text style={[type.caption, { color: theme.textSecondary }]}>Joined {timeAgo(u.created_at)}</Text>
              </View>
              <ChoiceRow
                options={ROLES}
                labels={ROLE_LABEL}
                value={u.role}
                disabled={setRole.isPending || u.id === me.data?.id}
                onChange={(role) => role && role !== u.role && setRole.mutate({ userId: u.id, role })}
              />
            </View>
          ))}
        </Card>
      ) : (
        <Notice icon="information-circle-outline">Staff admins add and remove workers here.</Notice>
      )}

      {/* Sample data until training progress and partner records are stored. */}
      <Group
        header="Training compliance (sample)"
        headerIcon="school-outline"
        footer={`${REQUIRED_MODULES.length} of ${TRAINING_MODULES.length} modules are required before a first shift.`}
      >
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

      <Group header="Partners (sample)" headerIcon="business-outline">
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
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
