import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { space, type, useTheme } from '@/theme/tokens';

/**
 * Figma E4: a refresh failed but we still have the last good data. Say
 * what broke in plain words, keep showing what we had, and offer one retry.
 * Renders nothing unless the query has both data and an error.
 */
export function RefreshError({
  query,
  what,
}: {
  query: { error: unknown; data: unknown; dataUpdatedAt: number; refetch: () => unknown };
  what: string;
}) {
  const theme = useTheme();
  if (!query.error || query.data === undefined) return null;
  const when = query.dataUpdatedAt ? timeAgo(new Date(query.dataUpdatedAt).toISOString()) : 'earlier';
  return (
    <View style={[styles.banner, { backgroundColor: theme.dangerSoft }]} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={20} color={theme.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.subhead, { color: theme.danger, fontWeight: '700' }]}>Couldn’t refresh {what}</Text>
        <Text style={[type.footnote, { color: theme.text }]}>
          Showing what you had {when}. Check your connection and try again.
        </Text>
      </View>
      <Button label="Retry" icon="refresh" variant="plain" onPress={() => query.refetch()} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 14 },
});
