import { StyleSheet, Text, View } from 'react-native';

import { initials } from '@/lib/format';
import { useTheme } from '@/theme/tokens';

/** A person's initials in a soft green circle. */
export function Avatar({ name, size = 32 }: { name: string | null | undefined; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accentSoft }]}>
      <Text style={{ color: theme.accent, fontWeight: '800', fontSize: Math.round(size * 0.38) }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
});
