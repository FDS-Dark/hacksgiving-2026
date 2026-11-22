import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar, type TabItem } from '@/components/TabBar';
import { tabReplaceAnimation } from '@/lib/tabDirection';
import { useTheme } from '@/theme/tokens';

/** Figma "App shell v2" resident tabs. Get help pushes the request flow (/help) over them. */
const TABS: TabItem[] = [
  { label: 'Home', href: '/', icon: 'home-outline', iconActive: 'home', match: (p) => p === '/' },
  { label: 'Get help', push: '/help', icon: 'help-buoy-outline', iconActive: 'help-buoy', match: () => false },
  { label: 'Requests', href: '/requests', icon: 'list-outline', iconActive: 'list', match: (p) => p.startsWith('/requests') },
  { label: 'Awareness', href: '/safety', icon: 'shield-outline', iconActive: 'shield', match: (p) => p === '/safety' || p === '/alerts' },
  { label: 'Me', href: '/me', icon: 'person-outline', iconActive: 'person', match: (p) => p === '/me' || p === '/alerts' || p === '/opportunities' },
];

/**
 * The signed-in resident app: a Stack of screens over the bottom tab bar.
 * Full-screen flows (get help, a request, a place) are root routes outside it.
 */
export default function MainLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <Stack
        screenOptions={() => ({
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg },
          animationTypeForReplace: tabReplaceAnimation(),
        })}
      />
      <TabBar tabs={TABS} />
    </View>
  );
}
