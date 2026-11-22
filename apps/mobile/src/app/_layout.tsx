import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoTile } from '@/components/LogoTile';
import { AuthProvider, useAuth } from '@/lib/auth';
import { usePush } from '@/lib/push';
import { queryClient } from '@/services/queryClient';
import { useSendPendingRequests } from '@/services/requests';
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
  // Push handlers, once for the app; registration and taps need a real sign-in.
  usePush(status === 'signedIn');
  // Requests written offline go out once the phone is back online (Figma E3).
  useSendPendingRequests();

  if (status === 'loading' && !SKIP_AUTH) return <Splash />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      {/* Name the fallbacks: by default a denied route falls back to the
          first unguarded route in file order, which is "auth" (it sorts
          before "sign-in"), and that bounced back and forth until React
          gave up with "Maximum update depth exceeded". */}
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(main)" />
        {/* The staff app has its own tab bar, so it sits outside (main)'s header. */}
        <Stack.Screen name="staff" />
        {/* Place details cover the resident tabs (Figma R4). */}
        <Stack.Screen name="place/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
      </Stack.Protected>
      {/* Asking for help never waits on a sign-in. */}
      <Stack.Screen name="help" />
      <Stack.Screen name="auth" />
    </Stack>
  );
}

/** Figma "Step 1 · Launch": shown for the second or so it takes to check the sign-in. */
function Splash() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.splash, { backgroundColor: theme.surface, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.center}>
        <LogoTile size={88} />
        <Text style={[styles.name, { color: theme.text }]}>ComForce MKE</Text>
        <Text style={[styles.tagline, { color: theme.textSecondary }]}>We Empower. We Protect. We Uplift.</Text>
      </View>
      <View style={[styles.track, { backgroundColor: theme.separator }]}>
        <View style={[styles.bar, { backgroundColor: theme.accent }]} />
      </View>
      <Text style={[styles.footer, { color: theme.textSecondary }]}>Community Task Force Milwaukee</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', gap: space.md, padding: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  name: { fontSize: 28, fontWeight: '800' },
  tagline: { fontSize: 15 },
  track: { width: 72, height: 3, borderRadius: 2, overflow: 'hidden' },
  bar: { width: '45%', height: '100%', borderRadius: 2 },
  footer: { fontSize: 12 },
});
