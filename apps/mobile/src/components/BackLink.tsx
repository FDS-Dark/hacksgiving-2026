import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { space, type, useTheme } from '@/theme/tokens';

/**
 * The link at the top of a pushed screen. Two kinds, so the label never
 * promises a place it doesn't go (cognitive-load review: "Back to Queue"
 * opened another case):
 *
 * - `to` + `label` ("‹ Queue"): always goes to that screen. Pops whatever
 *   was pushed over it, then swaps it in, like a tab does.
 * - `fallback` only ("‹ Back"): follows history; `fallback` is for a deep
 *   link opened cold, with nothing to go back to. Any `label` is ignored:
 *   history can lead anywhere, so it only ever says "Back".
 */
export function BackLink(props: { to: Href; label: string } | { fallback: Href; label?: string }) {
  const theme = useTheme();
  const named = 'to' in props;
  const label = named ? props.label : 'Back';
  const go = () => {
    if ('to' in props) {
      if (router.canDismiss()) router.dismissAll();
      router.replace(props.to);
    } else if (router.canGoBack()) router.back();
    else router.replace(props.fallback);
  };
  return (
    <Pressable
      onPress={go}
      accessibilityRole="link"
      accessibilityLabel={named ? `Back to ${label}` : 'Back'}
      hitSlop={8}
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="chevron-back" size={18} color={theme.accent} />
      <Text style={[type.subhead, { color: theme.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', minHeight: 44, paddingVertical: space.xs },
});
