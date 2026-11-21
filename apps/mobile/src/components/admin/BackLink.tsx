import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { space, useTheme } from '@/theme/tokens';

/** "‹ Admin" back link above a sub-page's heading: to a route, or a custom action. */
export function BackLink({ label, href, onPress }: { label: string; href?: Href; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress ?? (() => href && router.navigate(href))} accessibilityRole="link" hitSlop={8} style={styles.back}>
      <Ionicons name="chevron-back" size={18} color={theme.accent} />
      <Text style={[styles.backText, { color: theme.accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', marginBottom: -space.md },
  backText: { fontSize: 15, fontWeight: '700' },
});
