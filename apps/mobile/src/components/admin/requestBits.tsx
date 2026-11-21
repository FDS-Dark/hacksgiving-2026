import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { IconName } from '@/components/ui';
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status } from '@/lib/requests';
import { useTheme, type Theme } from '@/theme/tokens';

/** Small labels shared by the request queue and the request page. */

export function priorityColors(theme: Theme, p: Priority) {
  switch (p) {
    case 'urgent':
      return { fg: theme.danger, bg: theme.dangerSoft };
    case 'high':
      return { fg: theme.soon, bg: theme.warningSoft };
    case 'normal':
      return { fg: theme.accent, bg: theme.accentSoft };
    case 'low':
      return { fg: theme.textSecondary, bg: theme.fill };
  }
}

export function Badge({ label, fg, bg, icon }: { label: string; fg: string; bg: string; icon?: IconName }) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const theme = useTheme();
  const c = priorityColors(theme, priority);
  return <Badge label={PRIORITY_LABEL[priority]} fg={c.fg} bg={c.bg} icon={priority === 'urgent' ? 'alert-circle' : undefined} />;
}

export function StatusBadge({ status }: { status: Status }) {
  const theme = useTheme();
  const done = status === 'resolved' || status === 'closed';
  return (
    <Badge
      label={STATUS_LABEL[status]}
      fg={status === 'new' ? theme.onAccent : done ? theme.textSecondary : theme.text}
      bg={status === 'new' ? theme.accent : theme.fill}
      icon={done ? 'checkmark' : undefined}
    />
  );
}

export function ConfidentialBadge() {
  const theme = useTheme();
  return <Badge label="Confidential" fg={theme.text} bg={theme.fill} icon="lock-closed" />;
}

export function OverdueBadge() {
  const theme = useTheme();
  return <Badge label="Overdue" fg={theme.onAccent} bg={theme.danger} icon="time" />;
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
