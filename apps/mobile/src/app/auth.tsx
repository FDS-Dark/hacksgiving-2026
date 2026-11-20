import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme/tokens';

/** The Auth0 redirect target (hacksgiving://auth, or exp://…/--/auth in Expo Go).
 * The browser session normally swallows it; when the OS hands it to the app
 * too, the router lands here while the code exchange is still running.
 *
 * Don't redirect to "/" until signed in: "/" is a signed-in-only screen, so
 * the guard would bounce back here and the two redirects would loop
 * ("Maximum update depth exceeded"). Wait for the exchange instead. */
export default function AuthRedirect() {
  const theme = useTheme();
  const { status, busy } = useAuth();

  if (status === 'signedIn') return <Redirect href="/" />;
  if (status === 'signedOut' && !busy) return <Redirect href="/sign-in" />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
      <ActivityIndicator color={theme.textSecondary} />
    </View>
  );
}
