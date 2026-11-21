import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Task } from '@/api/types';
import { Button, ErrorBanner, Field, tap } from '@/components/ui';
import { dateTime, timeAgo } from '@/lib/format';
import { useCreateTask, useUpdateTask } from '@/services/tasks';
import { space, type, useTheme } from '@/theme/tokens';

/** Open tasks first (soonest due), then the finished ones. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  const due = (t: Task) => (t.due_at ? Date.parse(t.due_at) : Number.POSITIVE_INFINITY);
  return [...tasks].sort((a, b) => (a.status === b.status ? due(a) - due(b) : a.status === 'open' ? -1 : 1));
}

/** Figma S3 Tasks tab: the case's to-dos (from the case detail). Tap the circle to finish one; add your own below. */
export function CaseTasks({ caseId, tasks }: { caseId: string; tasks: Task[] }) {
  const theme = useTheme();
  // "Overdue" is judged against when the list was opened, not re-read on every render.
  const [now] = useState(() => Date.now());
  const list = sortTasks(tasks);
  return (
    <View style={{ gap: space.md }}>
      {list.length ? (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {list.map((t, i) => (
            <TaskRow key={t.id} task={t} first={i === 0} now={now} />
          ))}
        </View>
      ) : (
        <Text style={[type.subhead, { color: theme.textSecondary }]}>No tasks on this case yet.</Text>
      )}
      <AddTask caseId={caseId} />
    </View>
  );
}

function TaskRow({ task: t, first, now }: { task: Task; first: boolean; now: number }) {
  const theme = useTheme();
  const update = useUpdateTask();
  const done = t.status === 'done';
  const overdue = !done && t.due_at && Date.parse(t.due_at) < now;
  const meta = done
    ? `Done ${t.completed_at ? timeAgo(t.completed_at) : ''}`.trim()
    : [t.due_at ? `Due ${dateTime(t.due_at)}` : null, t.assigned_worker_name].filter(Boolean).join(' · ');

  return (
    <Pressable
      onPress={() => {
        tap();
        update.mutate({ id: t.id, body: { status: done ? 'open' : 'done' } });
      }}
      disabled={update.isPending}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done, disabled: update.isPending }}
      accessibilityLabel={t.title}
      style={({ pressed }) => [styles.row, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={done ? theme.accent : theme.textTertiary} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: done ? theme.textSecondary : theme.text, textDecorationLine: done ? 'line-through' : 'none' }]}>{t.title}</Text>
        {meta ? <Text style={[type.caption, { color: overdue ? theme.danger : theme.textSecondary }]}>{meta}</Text> : null}
      </View>
    </Pressable>
  );
}

function AddTask({ caseId }: { caseId: string }) {
  const create = useCreateTask(caseId);
  const [title, setTitle] = useState('');
  const add = () => title.trim() && create.mutate({ title: title.trim() }, { onSuccess: () => setTitle('') });
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.add}>
        <View style={{ flex: 1 }}>
          <Field placeholder="Add a task" value={title} onChangeText={setTitle} onSubmitEditing={add} returnKeyType="done" maxLength={200} accessibilityLabel="New task" />
        </View>
        <Button label="Add" icon="add" variant="tinted" disabled={!title.trim()} loading={create.isPending} onPress={add} />
      </View>
      {create.error ? <ErrorBanner error={create.error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  add: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
