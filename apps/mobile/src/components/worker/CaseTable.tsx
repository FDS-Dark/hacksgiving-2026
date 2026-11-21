import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import type { Case } from '@/api/types';
import { CATEGORY_ICON, CATEGORY_LABEL, PriorityBadge, StatusBadge, priorityColor, timeAgo } from '@/components/worker/kit';
import { radius, space, type, useTheme } from '@/theme/tokens';

/** Below this width the queue is a list of cards instead of a table. */
const TABLE_WIDTH = 820;

export function CaseTable({ cases }: { cases: Case[] }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const table = width >= TABLE_WIDTH;

  if (!table) {
    return (
      <View style={{ gap: space.sm }}>
        {cases.map((c) => (
          <CaseCard key={c.id} item={c} />
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.table, { borderColor: theme.separator, backgroundColor: theme.surface }]}>
      <View style={[styles.row, styles.headRow, { borderBottomColor: theme.separator, backgroundColor: theme.fill }]}>
        <Head style={styles.colCase}>Case</Head>
        <Head style={styles.colPriority}>Priority</Head>
        <Head style={styles.colStatus}>Status</Head>
        <Head style={styles.colAssignee}>Assigned</Head>
        <Head style={styles.colTime}>Opened</Head>
        <Head style={styles.colTime}>Activity</Head>
      </View>
      {cases.map((c, i) => (
        <CaseRow key={c.id} item={c} last={i === cases.length - 1} />
      ))}
    </View>
  );
}

function Head({ children, style }: { children: string; style: object }) {
  const theme = useTheme();
  return <Text style={[type.caption, styles.head, { color: theme.textSecondary }, style]}>{children}</Text>;
}

function open(c: Case) {
  router.push({ pathname: '/worker/cases/[id]', params: { id: c.id } });
}

function CaseRow({ item: c, last }: { item: Case; last: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => open(c)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="link"
      accessibilityLabel={`Case ${c.number}: ${c.title}. ${c.priority} priority, ${c.status.replace('_', ' ')}`}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.separator, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
        { borderLeftColor: priorityColor(theme, c.priority), borderLeftWidth: c.priority === 'critical' || c.priority === 'high' ? 3 : 0 },
        hovered && { backgroundColor: theme.fill },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.colCase, { gap: 2 }]}>
        <View style={styles.titleLine}>
          <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '700' }]}>#{c.number}</Text>
          {c.kind === 'incident' ? <Text style={[styles.kind, { color: theme.danger, borderColor: theme.danger }]}>INCIDENT</Text> : null}
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
            {c.title}
          </Text>
        </View>
        <View style={styles.titleLine}>
          <Ionicons name={CATEGORY_ICON[c.category]} size={13} color={theme.textSecondary} />
          <Text style={[type.caption, { color: theme.textSecondary }]} numberOfLines={1}>
            {CATEGORY_LABEL[c.category]}
            {c.location ? ` · ${c.location}` : ''}
            {c.source === 'public' ? ' · from the community' : ''}
          </Text>
        </View>
      </View>
      <View style={styles.colPriority}>
        <PriorityBadge priority={c.priority} />
      </View>
      <View style={styles.colStatus}>
        <StatusBadge status={c.status} />
      </View>
      <Text style={[type.footnote, styles.colAssignee, { color: c.assigned_worker_name ? theme.text : theme.textTertiary }]} numberOfLines={1}>
        {c.assigned_worker_name ?? 'Unassigned'}
      </Text>
      <Text style={[type.footnote, styles.colTime, { color: theme.textSecondary }]}>{timeAgo(c.created_at)}</Text>
      <Text style={[type.footnote, styles.colTime, { color: theme.textSecondary }]}>{timeAgo(c.last_activity_at)}</Text>
    </Pressable>
  );
}

function CaseCard({ item: c }: { item: Case }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => open(c)}
      accessibilityRole="link"
      accessibilityLabel={`Case ${c.number}: ${c.title}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.separator, borderLeftColor: priorityColor(theme, c.priority) },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.titleLine}>
        <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '700' }]}>#{c.number}</Text>
        <Text style={[type.caption, { color: theme.textSecondary, flex: 1 }]} numberOfLines={1}>
          {CATEGORY_LABEL[c.category]} · {timeAgo(c.created_at)}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
      </View>
      <Text style={[type.headline, { color: theme.text }]} numberOfLines={2}>
        {c.kind === 'incident' ? 'Incident: ' : ''}
        {c.title}
      </Text>
      <View style={[styles.titleLine, { flexWrap: 'wrap' }]}>
        <PriorityBadge priority={c.priority} />
        <StatusBadge status={c.status} />
        <Text style={[type.caption, { color: theme.textSecondary }]}>{c.assigned_worker_name ?? 'Unassigned'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  table: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  headRow: { paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  colCase: { flex: 1, minWidth: 0 },
  colPriority: { width: 100 },
  colStatus: { width: 160 },
  colAssignee: { width: 140 },
  colTime: { width: 80 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kind: { fontSize: 10, fontWeight: '800', borderWidth: 1, borderRadius: 4, paddingHorizontal: 4 },
  card: { borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
