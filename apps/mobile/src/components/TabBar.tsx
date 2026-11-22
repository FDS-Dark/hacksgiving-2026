import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/components/ui';
import { setTabReplaceAnimation, tabDirection } from '@/lib/tabDirection';
import { space, useTheme } from '@/theme/tokens';

export interface TabItem {
  label: string;
  icon: IconName;
  iconActive: IconName;
  /** A tab root: swapped in place (replace) after popping pushed screens, so tabs never build a back stack. */
  href?: Href;
  /** An action tab (Record, Get help): pushes a flow over the tabs instead. */
  push?: Href;
  /** Raised, filled green circle in the middle (staff Record). */
  raised?: boolean;
  match: (path: string) => boolean;
}

/**
 * The bottom tab bar from the Figma app shell, for both the resident and
 * the staff app. Each layout renders it under its Stack and passes its tabs.
 */
export function TabBar({ tabs }: { tabs: TabItem[] }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const activeIndex = tabs.findIndex((t) => t.match(pathname));
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { backgroundColor: theme.surface, borderTopColor: theme.separator, paddingBottom: Math.max(insets.bottom, space.md) }]}
    >
      {tabs.map((tab, index) => {
        const active = tab.match(pathname);
        const color = active || tab.raised ? theme.accent : theme.textSecondary;
        const go = () => {
          if (active) return;
          if (tab.push) return router.push(tab.push);
          if (!tab.href) return;
          // Pop anything pushed over the current tab first, so Back never lands on an old tab.
          if (router.canDismiss()) router.dismissAll();
          // Slide toward the tab that was pressed: from the right for a tab
          // to the right, from the left for one to the left.
          setTabReplaceAnimation(tabDirection(activeIndex, index));
          router.replace(tab.href);
        };
        return (
          <Pressable
            key={tab.label}
            onPress={go}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            {tab.raised ? (
              <View style={[styles.raised, { backgroundColor: theme.accent, borderColor: theme.surface }]}>
                <Ionicons name={tab.iconActive} size={24} color={theme.onAccent} />
              </View>
            ) : (
              <Ionicons name={active ? tab.iconActive : tab.icon} size={22} color={color} />
            )}
            <Text style={[styles.label, { color, fontWeight: active || tab.raised ? '700' : '500' }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  label: { fontSize: 11 },
  raised: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: -22, borderWidth: 4 },
});
