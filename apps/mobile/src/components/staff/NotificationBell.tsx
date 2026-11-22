/** The bell in Today's header, with the unread count; opens the inbox (S7). */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useUnreadCount } from '@/services/notifications';
import { useTheme } from '@/theme/tokens';

export function NotificationBell() {
  const theme = useTheme();
  const unread = useUnreadCount();
  const count = unread.data?.count ?? 0;
  return (
    <Pressable
      onPress={() => router.push('/staff/notifications')}
      accessibilityRole="button"
      accessibilityLabel={count ? `Notifications, ${count} unread` : 'Notifications'}
      hitSlop={6}
      style={({ pressed }) => [styles.bell, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={count ? 'notifications' : 'notifications-outline'} size={24} color={theme.text} />
      {count ? (
        <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.bg }]}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
});
