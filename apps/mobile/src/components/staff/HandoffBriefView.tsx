import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ShiftHandoff } from '@/api/types';
import { Badge, Card, CardTitle, priorityColor } from '@/components/staff/kit';
import { dateTime, timeAgo } from '@/lib/format';
import { space, type, useTheme } from '@/theme/tokens';

/** Who handed what to whom, as a one-liner. */
export function handoffTitle(h: ShiftHandoff, myId: string | undefined) {
  const from = h.author_id === myId ? 'You' : (h.author_name ?? 'A teammate');
  const to = h.recipient_id === myId ? 'you' : (h.recipient_name ?? 'whoever is on next');
  return `${from} → ${to}`;
}

export function handoffCounts(h: ShiftHandoff) {
  const { cases, tasks, alerts } = h.brief;
  const overdue = tasks.filter((t) => t.overdue).length;
  return [
    alerts.length ? `${alerts.length} urgent` : null,
    `${cases.length} case${cases.length === 1 ? '' : 's'}`,
    `${tasks.length} task${tasks.length === 1 ? '' : 's'}${overdue ? ` (${overdue} overdue)` : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The brief itself: summary, urgent responses, cases, tasks. Rows open the live case. */
export function HandoffBriefView({ handoff: h }: { handoff: ShiftHandoff }) {
  const theme = useTheme();
  const { cases, tasks, alerts } = h.brief;
  const open = (id: string) => router.push({ pathname: '/staff/cases/[id]', params: { id } });

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <CardTitle title="Summary" right={<Badge label={h.summary_source === 'ai' ? 'AI' : 'Auto'} color={theme.textSecondary} />} />
        <Text style={[type.body, { color: theme.text }]} selectable>
          {h.summary}
        </Text>
        <Text style={[type.caption, { color: theme.textSecondary }]}>
          Snapshot from {dateTime(h.created_at)} ({timeAgo(h.created_at)}). Open a case for where it stands now.
        </Text>
      </Card>

      {alerts.length ? (
        <Section title="Urgent responses in progress" danger>
          {alerts.map((a, i) => (
            <Line key={a.id} first={i === 0} color={theme.danger} title={`#${a.case_number} ${a.case_title}`} meta={a.arrived_at ? 'On scene' : 'Accepted, on the way'} onPress={() => open(a.case_id)} />
          ))}
        </Section>
      ) : null}

      <Section title={`Open cases · ${cases.length}`}>
        {cases.length ? (
          cases.map((c, i) => (
            <Line key={c.id} first={i === 0} color={priorityColor(theme, c.priority)} title={`#${c.number} ${c.title}`} meta={`${c.priority} · ${c.status.replace('_', ' ')}`} onPress={() => open(c.id)} />
          ))
        ) : (
          <Text style={[type.subhead, styles.empty, { color: theme.textSecondary }]}>No open cases.</Text>
        )}
      </Section>

      <Section title={`Open tasks · ${tasks.length}`}>
        {tasks.length ? (
          tasks.map((t, i) => (
            <Line
              key={t.id}
              first={i === 0}
              color={t.overdue ? theme.danger : theme.textTertiary}
              title={t.title}
              meta={`#${t.case_number} ${t.case_title}${t.due_at ? ` · ${t.overdue ? 'overdue, was due' : 'due'} ${dateTime(t.due_at)}` : ''}`}
              metaDanger={t.overdue}
              onPress={() => open(t.case_id)}
            />
          ))
        ) : (
          <Text style={[type.subhead, styles.empty, { color: theme.textSecondary }]}>No open tasks.</Text>
        )}
      </Section>
    </View>
  );
}

function Section({ title, danger, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.section, { color: danger ? theme.danger : theme.textSecondary }]}>{title}</Text>
      <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>{children}</View>
    </View>
  );
}

function Line({ title, meta, color, first, metaDanger, onPress }: { title: string; meta: string; color: string; first: boolean; metaDanger?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens the case"
      style={({ pressed }) => [styles.row, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.text }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[type.caption, { color: metaDanger ? theme.danger : theme.textSecondary }]}>{meta}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  empty: { padding: space.md },
});
