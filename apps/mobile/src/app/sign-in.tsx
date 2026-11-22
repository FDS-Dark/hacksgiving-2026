import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LogoTile } from '@/components/LogoTile';
import { QuickExitButton } from '@/components/resident';
import { Button, Txt, type IconName } from '@/components/ui';
import { auth0Configured, devSignInAvailable, redirectUri, useAuth } from '@/lib/auth';
import { radius, space, useTheme } from '@/theme/tokens';

const BENEFITS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'help-buoy-outline', title: 'Ask for help anytime', detail: 'Tell us what is going on. A real person follows up.' },
  { icon: 'location-outline', title: 'Find support near you', detail: 'Shelters, meals, rides and programs across the city.' },
  { icon: 'chatbubble-outline', title: 'Follow your request', detail: 'See where it stands and message the team.' },
];

/**
 * Figma "Step 2 · Welcome": the first screen for anyone signed out. What
 * the app does, one primary action, and the 911 line. Asking for help
 * never needs an account, so that link is here too.
 */
export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn, signInWithDevToken, busy, error } = useAuth();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={[styles.root, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg }]}
    >
      <View style={styles.exitRow}>
        <QuickExitButton />
      </View>

      <View style={{ gap: space.md }}>
        <LogoTile size={56} />
        <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
          Help is one tap away.
        </Text>
        <Txt variant="body" tone="secondary">
          ComForce MKE connects Milwaukee residents with shelter, food, rides, jobs and people who show up, 24/7.
        </Txt>
      </View>

      <View style={{ gap: space.lg }}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={styles.benefit}>
            <View style={[styles.benefitIcon, { backgroundColor: theme.fill }]}>
              <Ionicons name={b.icon} size={20} color={theme.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.benefitTitle, { color: theme.text }]}>{b.title}</Text>
              <Txt variant="footnote" tone="secondary">
                {b.detail}
              </Txt>
            </View>
          </View>
        ))}
      </View>

      <View style={{ flex: 1 }} />

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
            <Button label="Create a free account" size="lg" loading={busy} onPress={() => signIn({ signUp: true })} />
            <Button label="I already have an account" size="lg" variant="tinted" disabled={busy} onPress={() => signIn()} />
          </>
        ) : (
          <View style={[styles.notice, { backgroundColor: theme.fill }]}>
            <Txt variant="headline">Sign-in isn’t set up yet</Txt>
            <Txt variant="subhead" tone="secondary">
              Add EXPO_PUBLIC_AUTH0_DOMAIN, _CLIENT_ID and _AUDIENCE to apps/mobile/.env.local, then restart Expo.
            </Txt>
          </View>
        )}

        <Button label="Ask for help without an account" variant="plain" onPress={() => router.push('/help')} />

        <Text style={[styles.danger, { color: theme.danger }]}>In danger right now? Call 911 from your phone.</Text>

        {devSignInAvailable ? <Button label="Continue with dev token" variant="plain" onPress={signInWithDevToken} /> : null}
        {__DEV__ && auth0Configured ? (
          <Txt variant="footnote" tone="tertiary" style={{ textAlign: 'center' }} selectable>
            Callback URL: {redirectUri}
          </Txt>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingHorizontal: space.lg, gap: space.xl },
  exitRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  benefitIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { fontSize: 15, fontWeight: '700' },
  actions: { gap: space.sm },
  danger: { textAlign: 'center', fontSize: 14, fontWeight: '600', paddingVertical: space.sm },
  error: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg },
  notice: { borderRadius: radius.lg, padding: space.lg, gap: 4 },
});
