import { StyleSheet, Text, View } from 'react-native';

import type { CaseStatus } from '@/api/types';
import { STATUS_INFO } from '@/lib/requests';
import { space, useTheme } from '@/theme/tokens';

/** A request's status as the requester sees it: green while open, gray once done. */
export function StatusPill({ status }: { status: CaseStatus }) {
  const theme = useTheme();
  const info = STATUS_INFO[status];
  return (
    <View style={[styles.pill, { backgroundColor: info.open ? theme.accentSoft : theme.fill }]}>
      <Text style={[styles.text, { color: info.open ? theme.accent : theme.textSecondary }]}>{info.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '800' },
});
