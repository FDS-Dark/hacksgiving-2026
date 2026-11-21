import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DebriefRecord } from '@/api/types';
import { timeAgo } from '@/lib/format';
import { useRecords } from '@/services/records';
import { space, type, useTheme, type Theme } from '@/theme/tokens';

function line(theme: Theme, r: DebriefRecord): { text: string; color: string } {
  switch (r.status) {
    case 'ready':
      return { text: 'Ready to check', color: theme.accent };
    case 'failed':
      return { text: 'Couldn’t finish · try again', color: theme.danger };
    default:
      return { text: 'Processing…', color: theme.textSecondary };
  }
}

/** Today's open debriefs: still processing, waiting for review, or failed. Nothing when there are none. */
export function Debriefs() {
  const theme = useTheme();
  const records = useRecords();
  const open = (records.data ?? []).filter((r) => r.status === 'processing' || r.status === 'confirming' || r.status === 'ready' || r.status === 'failed');
  if (!open.length) return null;
  return (
    <View style={{ gap: space.sm }}>
      <Text accessibilityRole="header" style={[type.headline, { color: theme.text }]}>
        Your debriefs
      </Text>
      {open.slice(0, 5).map((r) => {
        const { text, color } = line(theme, r);
        const title = r.extraction?.title ?? (r.raw_text ? `${r.raw_text.slice(0, 60)}${r.raw_text.length > 60 ? '…' : ''}` : 'Debrief');
        return (
          <Pressable
            key={r.id}
            onPress={() => router.push({ pathname: '/staff/records/[id]', params: { id: r.id } })}
            accessibilityRole="link"
            accessibilityLabel={`Debrief: ${title}. ${text}`}
            style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
          >
            {r.status === 'processing' || r.status === 'confirming' ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Ionicons name={r.status === 'failed' ? 'alert-circle' : 'sparkles'} size={20} color={color} />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[type.caption, { color }]}>
                {text} · {timeAgo(r.created_at)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.textTertiary} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: space.md },
});
