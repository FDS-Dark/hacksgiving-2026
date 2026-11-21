import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandLogo } from '@/components/BrandLogo';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/services/queryClient';
import { space, useTheme } from '@/theme/tokens';

export default function RootLayout() {
  const theme = useTheme();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootStack />
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaProvider>
  );
}

/** Dev only: EXPO_PUBLIC_SKIP_AUTH=1 in .env.local opens the app without
 *  signing in, for working on screens. API calls that need a user will fail. */
const SKIP_AUTH = __DEV__ && process.env.EXPO_PUBLIC_SKIP_AUTH === '1';

function RootStack() {
  const theme = useTheme();
  const { status } = useAuth();
  const signedIn = SKIP_AUTH || status === 'signedIn';

  if (status === 'loading' && !SKIP_AUTH) return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      {/* Name the fallbacks: by default a denied route falls back to the
          first unguarded route in file order, which is "auth" (it sorts
          before "sign-in"), and that bounced back and forth until React
          gave up with "Maximum update depth exceeded". */}
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(main)" />
        <Stack.Screen name="worker" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Screen name="auth" />
    </Stack>
  );
}

function Splash() {
  const theme = useTheme();
  return (
    <View style={[styles.splash, { backgroundColor: theme.bg }]}>
      <BrandLogo width={260} />
      <ActivityIndicator color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
});
