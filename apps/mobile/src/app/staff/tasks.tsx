import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Task } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Segmented } from '@/components/Segmented';
import { priorityColor } from '@/components/staff/kit';
import { EmptyState, ErrorBanner, Loading, tap } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';
import { BUCKET_LABEL, groupTasks } from '@/lib/myTasks';
import { useTasks, useUpdateTask } from '@/services/tasks';
import { space, type, useTheme } from '@/theme/tokens';

type View_ = 'open' | 'done';

/**
 * My tasks: every task assigned to me (or on a case I own), across cases.
 * Open ones are grouped by when they're due; tap the circle to finish one,
 * tap the row to open its case.
 */
export default function MyTasksScreen() {
  const theme = useTheme();
  const [view, setView] = useState<View_>('open');
  const tasks = useTasks({ mine: true, open_only: view === 'open', limit: 200 });
  // "Overdue" is judged against when the list was opened, not re-read on every render.
  const [now] = useState(() => new Date());
  const groups = useMemo(() => {
    if (!tasks.data) return [];
    if (view === 'open') return groupTasks(tasks.data, now);
    const done = tasks.data.filter((t) => t.status === 'done');
    done.sort((a, b) => Date.parse(b.completed_at ?? b.created_at) - Date.parse(a.completed_at ?? a.created_at));
    return done.length ? [{ bucket: 'done' as const, tasks: done.slice(0, 50) }] : [];
  }, [tasks.data, view, now]);
  const openCount = view === 'open' ? (tasks.data?.length ?? 0) : null;

  return (
    <Page refreshing={tasks.isRefetching} onRefresh={() => tasks.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Today" fallback="/staff" />
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          My tasks
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          {openCount === null ? 'Recently finished' : openCount ? `${openCount} open across your cases` : 'Follow-ups on the cases you own'}
        </Text>
      </View>

      <Segmented
        label="Which tasks"
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'done', label: 'Done' },
        ]}
      />

      {tasks.isPending ? (
        <Loading label="Loading your tasks" />
      ) : tasks.error ? (
        <ErrorBanner error={tasks.error} onRetry={() => tasks.refetch()} />
      ) : groups.length ? (
        groups.map((g) => (
          <View key={g.bucket} style={{ gap: 6 }}>
            <Text style={[styles.section, { color: g.bucket === 'overdue' ? theme.danger : theme.textSecondary }]}>
              {g.bucket === 'done' ? 'Done' : BUCKET_LABEL[g.bucket]} · {g.tasks.length}
            </Text>
            <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
              {g.tasks.map((t, i) => (
                <MyTaskRow key={t.id} task={t} first={i === 0} overdue={g.bucket === 'overdue'} />
              ))}
            </View>
          </View>
        ))
      ) : view === 'open' ? (
        <EmptyState icon="checkmark-done-outline" title="All caught up" body="No open tasks on your cases. New follow-ups show up here as cases are assigned to you." />
      ) : (
        <EmptyState icon="time-outline" title="Nothing finished yet" body="Tasks you complete show up here." />
      )}
    </Page>
  );
}

function MyTaskRow({ task: t, first, overdue }: { task: Task; first: boolean; overdue: boolean }) {
  const theme = useTheme();
  const update = useUpdateTask();
  const done = t.status === 'done';
  const when = done
    ? `Done ${t.completed_at ? timeAgo(t.completed_at) : ''}`.trim()
    : t.due_at
      ? `Due ${dateTime(t.due_at)}`
      : null;

  return (
    <View style={[styles.row, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Pressable
        onPress={() => {
          tap();
          update.mutate({ id: t.id, body: { status: done ? 'open' : 'done' } });
        }}
        disabled={update.isPending}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done, disabled: update.isPending }}
        accessibilityLabel={done ? `Reopen: ${t.title}` : `Mark done: ${t.title}`}
      >
        <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={done ? theme.accent : theme.textTertiary} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [{ flex: 1, gap: 2 }, pressed && { opacity: 0.7 }]}
        onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: t.case_id } })}
        accessibilityRole="button"
        accessibilityLabel={`${t.title}, case ${t.case_number}`}
        accessibilityHint="Opens the case"
      >
        <Text style={[type.subhead, { color: done ? theme.textSecondary : theme.text, textDecorationLine: done ? 'line-through' : 'none' }]}>
          {t.title}
        </Text>
        <View style={styles.meta}>
          <View style={[styles.dot, { backgroundColor: priorityColor(theme, t.case_priority) }]} />
          <Text style={[type.caption, { color: theme.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
            #{t.case_number} {t.case_title}
          </Text>
        </View>
        {when ? <Text style={[type.caption, { color: overdue ? theme.danger : theme.textSecondary }]}>{when}</Text> : null}
      </Pressable>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800' },
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
