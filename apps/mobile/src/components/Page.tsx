import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_CONTENT_WIDTH, space, useTheme } from '@/theme/tokens';

/**
 * A scrolling page inside a tabbed layout. The layout clears the status
 * bar and the tab bar sits below, so only the bottom safe area is padded
 * here. On wide screens the content is centered.
 *
 * `header` stays pinned above the scrolling body. Resident tabs put their
 * ResidentHeader there, so Quick exit never scrolls out of reach.
 */
export function Page({
  children,
  header,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  header?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const maxWidth = StyleSheet.flatten(contentStyle)?.maxWidth ?? MAX_CONTENT_WIDTH;
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {header ? (
        <View style={[styles.header, { maxWidth, backgroundColor: theme.bg }]}>{header}</View>
      ) : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} /> : undefined}
      >
        <View
          style={[
            { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: header ? space.md : space.xl, gap: space.xl },
            contentStyle,
          ]}
        >
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
});
