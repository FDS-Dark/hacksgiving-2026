import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLogo } from '@/components/BrandLogo';
import { Display, Green, RedRule, Ribbon } from '@/components/brand';
import { Button, Txt } from '@/components/ui';
import { auth0Configured, devSignInAvailable, redirectUri, useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme/tokens';

/** The first screen for anyone signed out. Sign-up and sign-in both go
 *  through Auth0 Universal Login; "Create an account" opens it on sign-up. */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithDevToken, busy, error } = useAuth();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={[styles.root, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}
    >
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
        <BrandLogo width={260} />

        <View style={styles.intro}>
          <Ribbon>We Empower. We Protect. We Uplift.</Ribbon>
          <Display size={34}>
            Join <Green>ComForce MKE</Green>
          </Display>
          <Txt variant="body" tone="secondary">
            Create a free account to find jobs and volunteer opportunities, resources, and support across Milwaukee.
          </Txt>
          <RedRule />
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
              <View style={styles.signInRow}>
                <Text style={{ color: theme.textSecondary, fontSize: 15 }}>Already have an account?</Text>
                <Button label="Sign in" variant="plain" disabled={busy} onPress={() => signIn()} />
              </View>
            </>
          ) : (
            <View style={[styles.notice, { backgroundColor: theme.fill }]}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg },
  card: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: space.xl, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  intro: { gap: space.md },
  actions: { gap: space.sm },
  signInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
  notice: { borderRadius: radius.lg, padding: space.lg, gap: 4 },
});
