import { Pressable, StyleSheet, Text, View } from 'react-native';

import { tap } from '@/components/ui';
import { useTheme } from '@/theme/tokens';

/** A row of equal segments with one selected (Figma S3 Tasks / History / Referrals, S5 To resident / Internal note). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.fill }]} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (active) return;
              tap();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 }]}
          >
            <Text style={[styles.label, { color: active ? theme.text : theme.textSecondary, fontWeight: active ? '700' : '500' }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 3 },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, borderRadius: 9 },
  label: { fontSize: 13 },
});
