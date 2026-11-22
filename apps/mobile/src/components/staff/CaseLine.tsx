import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Case } from '@/api/types';
import { priorityColor, statusColor } from '@/components/staff/kit';
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { timeAgo } from '@/lib/format';
import { isOpenCase, isUrgentCase } from '@/lib/queue';
import { space, type, useTheme, type Theme } from '@/theme/tokens';

/** The rule color and the colored line under the title, for a case in a list (Figma S1). */
export function caseSummary(theme: Theme, c: Case): { color: string; line: string } {
  const who = c.assigned_worker_name ?? 'Unassigned';
  if (!isOpenCase(c)) return { color: theme.textTertiary, line: `${STATUS_LABEL[c.status]} · ${CATEGORY_LABEL[c.category]}` };
  if (isUrgentCase(c)) return { color: theme.danger, line: `${PRIORITY_LABEL[c.priority]} · ${CATEGORY_LABEL[c.category]} · ${who}` };
  if (c.status === 'new') return { color: statusColor(theme, 'new'), line: `New · not reviewed · ${CATEGORY_LABEL[c.category]}` };
  if (!c.assigned_worker_id) return { color: priorityColor(theme, 'high'), line: `No worker assigned · ${CATEGORY_LABEL[c.category]}` };
  return { color: statusColor(theme, c.status), line: `${STATUS_LABEL[c.status]} · ${CATEGORY_LABEL[c.category]} · ${who}` };
}

/**
 * One case as a row: a colored rule, "#1047 Title", why it's here in the
 * rule's color, and when it was opened. Today, Queue and Map all use it;
 * pass `color`/`line` to say something more specific than the default.
 */
export function CaseLine({ item: c, color, line, sub }: { item: Case; color?: string; line?: string; sub?: string | null }) {
  const theme = useTheme();
  const summary = caseSummary(theme, c);
  const tint = color ?? summary.color;
  const text = line ?? summary.line;
  const detail = sub === undefined ? `Opened ${timeAgo(c.created_at)}` : sub;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/staff/cases/[id]', params: { id: c.id } })}
      accessibilityRole="link"
      accessibilityLabel={`Case ${c.number}: ${c.title}. ${text}`}
      style={({ pressed }) => [styles.line, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.rule, { backgroundColor: tint }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={2}>
          #{c.number} {c.title}
        </Text>
        <Text style={[type.caption, { color: tint }]} numberOfLines={1}>
          {text}
        </Text>
        {detail ? (
          <Text style={[type.caption, { color: theme.textSecondary }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: space.md },
  rule: { width: 4, alignSelf: 'stretch', minHeight: 34, borderRadius: 2 },
});
