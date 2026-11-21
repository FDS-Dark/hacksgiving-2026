import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { space, type, useTheme } from '@/theme/tokens';

/** "‹ Queue": back if there is history, otherwise to `fallback` (a deep link opened cold). */
export function BackLink({ label, fallback }: { label: string; fallback: Href }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      accessibilityRole="link"
      accessibilityLabel={`Back to ${label}`}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="chevron-back" size={18} color={theme.accent} />
      <Text style={[type.subhead, { color: theme.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: space.xs },
});
