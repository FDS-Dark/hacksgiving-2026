import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { handoffCounts } from '@/components/staff/HandoffBriefView';
import { timeAgo } from '@/lib/format';
import { useHandoffs } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

const FRESH_MS = 12 * 60 * 60 * 1000;

/** Today: a brief handed to me in the last 12 hours, so I read it when my shift starts. */
export function HandoffCard() {
  const theme = useTheme();
  const me = useStaffStatus();
  const handoffs = useHandoffs(Boolean(me.data?.id));
  // "Fresh" is judged against when Today opened, not re-read on every render.
  const [now] = useState(() => Date.now());
  const handed = handoffs.data?.find(
    (h) => h.recipient_id === me.data?.id && h.author_id !== me.data?.id && now - Date.parse(h.created_at) < FRESH_MS,
  );
  if (!handed) return null;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/staff/handoffs/[id]', params: { id: handed.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Handoff from ${handed.author_name ?? 'a teammate'}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.accentSoft, borderColor: theme.accent }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="swap-horizontal-outline" size={22} color={theme.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: theme.text }]}>Handoff from {handed.author_name ?? 'a teammate'}</Text>
        <Text style={[type.footnote, { color: theme.textSecondary }]}>
          {handoffCounts(handed)} · {timeAgo(handed.created_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 14, padding: space.md },
});
