import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { CaseUpdate } from '@/api/types';
import { dateTime } from '@/lib/format';
import { space, type, useTheme } from '@/theme/tokens';

const UPDATE_ICON: Record<CaseUpdate['update_type'], keyof typeof Ionicons.glyphMap> = {
  created: 'add-circle',
  note: 'document-text',
  message: 'chatbubble-ellipses',
  status_change: 'swap-horizontal',
  priority_change: 'flag',
  category_change: 'pricetag',
  assignment: 'person',
  referral: 'link',
  reply: 'arrow-undo',
};

/** The case's History tab: every change, note and message, newest first. */
export function CaseHistory({ updates }: { updates: CaseUpdate[] }) {
  const theme = useTheme();
  const shown = [...updates].reverse();
  if (!shown.length) return <Text style={[type.subhead, { color: theme.textSecondary }]}>Nothing has happened on this case yet.</Text>;
  return (
    <View>
      {shown.map((u, i) => {
        const shared = u.visibility === 'public';
        const words = u.update_type === 'note' || u.update_type === 'message' || u.update_type === 'reply';
        return (
          <View key={u.id} style={styles.event}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: shared ? theme.accent : theme.surface, borderColor: theme.accent }]}>
                <Ionicons name={UPDATE_ICON[u.update_type]} size={12} color={shared ? theme.onAccent : theme.accent} />
              </View>
              {i < shown.length - 1 ? <View style={[styles.line, { backgroundColor: theme.separator }]} /> : null}
            </View>
            <View style={[styles.body, words && { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1, padding: space.md, borderRadius: 10 }]}>
              <Text style={[type.subhead, { color: theme.text }]} selectable>
                {u.content}
              </Text>
              <Text style={[type.caption, { color: theme.textSecondary }]}>
                {u.author_name ?? 'System'} · {dateTime(u.created_at)}
                {shared ? ' · visible to requester' : ''}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  event: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 24 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, minHeight: 12 },
  body: { flex: 1, gap: 2, marginBottom: space.md },
});
