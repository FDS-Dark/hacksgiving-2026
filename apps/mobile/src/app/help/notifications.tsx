import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BigButton, ResidentScreen } from '@/components/resident';
import { useAuth } from '@/lib/auth';
import { ensurePermission, markResidentAsked } from '@/lib/push';
import { useTheme } from '@/theme/tokens';

/**
 * Figma R6 "Notification ask": shown once, right after a signed-in resident's
 * first request is sent (help/received), so the reason is obvious. Then the
 * system prompt. Signed-out residents get no push, so never this screen.
 */
export default function NotificationAskScreen() {
  const theme = useTheme();
  const { status } = useAuth();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'signedIn') void markResidentAsked();
  }, [status]);

  if (status === 'signedOut') return <Redirect href="/help" />;

  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const turnOn = async () => {
    setBusy(true);
    await ensurePermission('resident');
    setBusy(false);
    leave();
  };

  return (
    <ResidentScreen
      back={false}
      contentStyle={styles.body}
      footer={
        <View style={{ gap: 4 }}>
          <BigButton label="Turn on notifications" onPress={turnOn} loading={busy} />
          <Pressable onPress={leave} disabled={busy} accessibilityRole="button" style={styles.notNow} hitSlop={6}>
            <Text style={[styles.notNowLabel, { color: theme.textSecondary }]}>Not now</Text>
          </Pressable>
        </View>
      }
    >
      <View style={[styles.bell, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="notifications-outline" size={44} color={theme.accent} />
      </View>
      <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
        Know the moment someone replies
      </Text>
      <Text style={[styles.lede, { color: theme.textSecondary }]}>
        Turn on notifications and we will tell you when ComForce answers or your request changes. Nothing else.
      </Text>
      <View style={[styles.privacy, { backgroundColor: theme.fill }]}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
        <Text style={[styles.privacyText, { color: theme.textSecondary }]}>Message text never shows on your lock screen.</Text>
      </View>
    </ResidentScreen>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  bell: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  lede: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignSelf: 'stretch' },
  privacyText: { fontSize: 13, flex: 1 },
  notNow: { alignItems: 'center', paddingVertical: 12 },
  notNowLabel: { fontSize: 16, fontWeight: '600' },
});
