import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/Wordmark';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/services/queryClient';
import { space, useTheme } from '@/theme/tokens';

export default function RootLayout() {
  const theme = useTheme();
  // The wordmark's face is the only custom font; the rest is the system font.
  const [loaded, error] = useFonts({ BricolageGrotesque_700Bold });

  // Hold on a plain background until it's in (or failed, in which case the
  // system font is used), so the wordmark doesn't reflow on first paint.
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

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

function RootStack() {
  const theme = useTheme();
  const { status } = useAuth();
  const signedIn = status === 'signedIn';

  if (status === 'loading') return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      {/* Name the fallbacks: by default a denied route falls back to the
          first unguarded route in file order, which is "auth" (it sorts
          before "sign-in"), and that bounced back and forth until React
          gave up with "Maximum update depth exceeded". */}
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(tabs)" />
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
      <Wordmark />
      <ActivityIndicator color={theme.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl },
});
