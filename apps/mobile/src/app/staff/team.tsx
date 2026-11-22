import { StyleSheet, Text, View } from 'react-native';

import type { Role } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ErrorBanner, Loading, Notice } from '@/components/ui';
import { Card, CardTitle, ChoiceRow, PageTitle } from '@/components/staff/kit';
import { timeAgo } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/staff';
import { useSetRole, useStaffStatus, useUsers, useWorkers } from '@/services/staff';
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
      <BackLink to="/staff/me" label="Me" />
      <PageTitle title="Team & roles" />
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
            Everyone who has signed in. Make ComForce staff workers; admins can also manage this list.
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

    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
});
