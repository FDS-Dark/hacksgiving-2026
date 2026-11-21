import { Slot } from 'expo-router';
import { View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AdminProvider } from '@/lib/admin';
import { useTheme } from '@/theme/tokens';

/**
 * Every signed-in screen sits under the AppHeader. Slot (no navigator)
 * means the header links swap the page in place instead of stacking them.
 */
export default function MainLayout() {
  const theme = useTheme();
  return (
    <AdminProvider>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppHeader />
        <Slot />
      </View>
    </AdminProvider>
  );
}
