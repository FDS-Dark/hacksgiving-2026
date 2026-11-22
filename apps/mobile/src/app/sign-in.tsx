import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoTile } from '@/components/LogoTile';
import { QuickExitButton } from '@/components/resident';
import { Button, ErrorBanner, Txt } from '@/components/ui';
import { auth0Configured, devSignInAvailable, redirectUri, useAuth } from '@/lib/auth';
import { callPhone } from '@/lib/phone';
import { radius, space, useTheme } from '@/theme/tokens';

/**
 * Figma "Step 2 · Welcome": the first screen for anyone signed out. Getting
 * help comes first and needs no account; the 911 line sits right under it.
 * The account choices come after. Quick exit stays pinned at the top.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithDevToken, busy, error } = useAuth();

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.exitRow, { paddingTop: insets.top + space.sm }]}>
        <QuickExitButton />
      </View>
      <ScrollView contentContainerStyle={[styles.root, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={{ gap: space.md }}>
          <LogoTile size={56} />
          <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
            ComForce MKE
          </Text>
          <Txt variant="body" tone="secondary">
            Tell us what is going on. A real person will follow up.
          </Txt>
        </View>

        <View style={styles.actions}>
          <Button label="Get help now" icon="help-buoy-outline" size="lg" onPress={() => router.push('/help')} />
          <Text onPress={() => callPhone('911')} accessibilityRole="link" style={[styles.danger, { color: theme.danger }]}>
            In danger right now? Call 911
          </Text>
        </View>

        <View style={styles.actions}>
          <Txt variant="footnote" tone="secondary" style={{ textAlign: 'center' }}>
            An account lets you follow your requests on any phone.
          </Txt>
          {error ? (
            <ErrorBanner error={new Error(error)} message="We couldn’t sign you in. Try again, or get help without an account." />
          ) : null}

          {auth0Configured ? (
            <>
              <Button label="Create a free account" size="lg" variant="tinted" loading={busy} onPress={() => signIn({ signUp: true })} />
              <Button label="I already have an account" size="lg" variant="plain" disabled={busy} onPress={() => signIn()} />
            </>
          ) : (
            <View style={[styles.notice, { backgroundColor: theme.fill }]}>
              <Txt variant="headline">Sign-in isn’t set up yet</Txt>
              <Txt variant="subhead" tone="secondary">
                Add EXPO_PUBLIC_AUTH0_DOMAIN, _CLIENT_ID and _AUDIENCE to apps/mobile/.env.local, then restart Expo.
              </Txt>
            </View>
          )}

          {devSignInAvailable ? <Button label="Continue with dev token" variant="plain" onPress={signInWithDevToken} /> : null}
          {__DEV__ && auth0Configured ? (
            <Txt variant="footnote" tone="tertiary" style={{ textAlign: 'center' }} selectable>
              Callback URL: {redirectUri}
            </Txt>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.md, gap: space.xl },
  exitRow: { flexDirection: 'row', justifyContent: 'flex-end', width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.lg },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  actions: { gap: space.sm },
  danger: { textAlign: 'center', fontSize: 15, fontWeight: '700', paddingVertical: space.md, minHeight: 44 },
  notice: { borderRadius: radius.lg, padding: space.lg, gap: 4 },
});
