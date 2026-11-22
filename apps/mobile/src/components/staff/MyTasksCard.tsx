import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { bucketOf } from '@/lib/myTasks';
import { useTasks } from '@/services/tasks';
import { space, type, useTheme } from '@/theme/tokens';

/** Today's link to My tasks: how many are open, and how many are overdue. */
export function MyTasksCard() {
  const theme = useTheme();
  const tasks = useTasks({ mine: true, open_only: true, limit: 200 });
  const [now] = useState(() => new Date());
  if (!tasks.data) return null;
  const open = tasks.data.length;
  const overdue = tasks.data.filter((t) => bucketOf(t, now) === 'overdue').length;
  const dueToday = tasks.data.filter((t) => bucketOf(t, now) === 'today').length;
  const line = open
    ? [overdue ? `${overdue} overdue` : null, dueToday ? `${dueToday} due today` : null, `${open} open`].filter(Boolean).join(' · ')
    : 'Nothing to do right now';

  return (
    <Pressable
      onPress={() => router.push('/staff/tasks')}
      accessibilityRole="button"
      accessibilityLabel={`My tasks: ${line}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: overdue ? theme.danger : theme.separator }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="checkbox-outline" size={22} color={overdue ? theme.danger : theme.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: theme.text }]}>My tasks</Text>
        <Text style={[type.footnote, { color: overdue ? theme.danger : theme.textSecondary }]}>{line}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, padding: space.md },
});
