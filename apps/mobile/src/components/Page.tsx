import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_CONTENT_WIDTH, space, useTheme } from '@/theme/tokens';

/**
 * A scrolling page under the AppHeader. The header already clears the
 * status bar, so only the bottom safe area is padded here. On wide screens
 * the content is centered at the site's container width.
 */
export function Page({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  bleed = false,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  /** Let children run edge to edge (they handle their own width and padding). */
  bleed?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} /> : undefined}
    >
      {bleed ? (
        children
      ) : (
        <Container style={[{ paddingTop: space.xl, gap: space.xl }, contentStyle]}>{children}</Container>
      )}
    </ScrollView>
  );
}

/** Centers content at the site's max width with the 16pt side margin. */
export function Container({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: space.lg }, style]}>{children}</View>;
}
