import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { unreadLabel } from '@/lib/chat';
import { unreadTotals, useChatChannels } from '@/services/chat';
import { space, type, useTheme } from '@/theme/tokens';

/** Today: the way into team chat, with what's unread across channels (rapid response in red). */
export function TeamChatCard() {
  const theme = useTheme();
  const channels = useChatChannels();
  const totals = channels.data ? unreadTotals(channels.data) : null;
  const pill = totals ? unreadLabel({ unread: totals.unread, rapid_unread: totals.rapid }) : null;
  const line = channels.isPending
    ? 'Loading…'
    : !channels.data
      ? 'Couldn’t load the chat. Tap to try again.'
      : totals?.unread
        ? `${totals.unread} unread across ${channels.data.filter((c) => c.unread).length} chat${channels.data.filter((c) => c.unread).length === 1 ? '' : 's'}`
        : 'Team, On call and case chats';
  return (
    <Pressable
      onPress={() => (channels.data ? router.push('/staff/chat') : channels.refetch())}
      accessibilityRole="button"
      accessibilityLabel={`Team chat${pill ? `, ${pill}` : ''}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="chatbubbles-outline" size={22} color={theme.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.headline, { color: theme.text }]}>Team chat</Text>
        <Text style={[type.footnote, { color: channels.data || channels.isPending ? theme.textSecondary : theme.danger }]}>{line}</Text>
      </View>
      {channels.isPending ? <ActivityIndicator color={theme.textSecondary} /> : null}
      {pill ? (
        <View style={[styles.pill, { backgroundColor: totals?.rapid ? theme.dangerSoft : theme.accentSoft }]}>
          <Text style={[type.footnote, { color: totals?.rapid ? theme.danger : theme.accent, fontWeight: '700' }]}>{pill}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: space.md, minHeight: 56 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
