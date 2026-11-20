import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from '@/components/Wordmark';
import { Button, Txt } from '@/components/ui';
import { auth0Configured, devSignInAvailable, redirectUri, useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme/tokens';

export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithDevToken, busy, error } = useAuth();

  return (
    <View style={[styles.root, { backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.brand}>
        <Wordmark size={52} />
        <Txt variant="body" tone="secondary" style={styles.lede}>
          Sign in to get started.
        </Txt>
      </View>

      <View style={styles.actions}>
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.dangerSoft }]}>
            <Ionicons name="alert-circle" size={18} color={theme.danger} />
            <Txt variant="subhead" tone="danger" style={{ flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}

        {auth0Configured ? (
          <>
            <Button label="Create an account" size="lg" loading={busy} onPress={() => signIn({ signUp: true })} />
            <Button label="Sign in" variant="tinted" size="lg" disabled={busy} onPress={() => signIn()} />
          </>
        ) : (
          <View style={[styles.notice, { backgroundColor: theme.surface }]}>
            <Txt variant="headline">Sign-in isn’t set up yet</Txt>
            <Txt variant="subhead" tone="secondary">
              Add EXPO_PUBLIC_AUTH0_DOMAIN, _CLIENT_ID and _AUDIENCE to apps/mobile/.env.local, then restart Expo.
            </Txt>
          </View>
        )}
        {devSignInAvailable ? (
          <Button
            label="Continue with dev token"
            variant={auth0Configured ? 'plain' : 'filled'}
            size={auth0Configured ? 'md' : 'lg'}
            onPress={signInWithDevToken}
          />
        ) : null}

        {__DEV__ && auth0Configured ? (
          <Txt variant="footnote" tone="tertiary" style={{ textAlign: 'center' }} selectable>
            Callback URL: {redirectUri}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl },
  brand: { flex: 1, justifyContent: 'center', gap: space.md },
  lede: { maxWidth: 340 },
  actions: { gap: space.sm },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
  notice: { borderRadius: radius.lg, padding: space.lg, gap: 4 },
});
