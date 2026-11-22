import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BigButton, Card, ResidentScreen } from '@/components/resident';
import { Button } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { callPhone } from '@/lib/phone';
import { firstContact } from '@/lib/requestStatus';
import { openSettings, pushSupported, shouldAskResident, subscribeToRequest } from '@/lib/push';
import { useSavedRequests } from '@/services/requests';
import { useTheme } from '@/theme/tokens';
import type { ContactMethod } from '@/api/types';

function isContactMethod(value: string | undefined): value is ContactMethod {
  return value === 'call' || value === 'text' || value === 'none';
}

/** Request received (Figma A3): the reference number and what happens next. */
export default function ReceivedScreen() {
  const { queued } = useLocalSearchParams<{ queued?: string }>();
  return queued ? <QueuedScreen /> : <SentScreen />;
}

/** Figma E3: written with no connection, kept on the phone, sent on reconnect. */
function QueuedScreen() {
  const theme = useTheme();
  return (
    <ResidentScreen
      back={false}
      contentStyle={{ alignItems: 'center', paddingTop: 40 }}
      footer={<BigButton label="Back to home" variant="outline" onPress={() => router.replace('/')} />}
    >
      <View style={[styles.check, { backgroundColor: theme.warningSoft }]}>
        <Ionicons name="cloud-offline-outline" size={44} color={theme.soon} />
      </View>
      <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
        Saved on your phone
      </Text>
      <Text style={[styles.lede, { color: theme.textSecondary }]}>
        You’re offline. Your request will send as soon as you have signal, even if you close this screen.
      </Text>
      <Pressable onPress={() => callPhone('911')} accessibilityRole="button" accessibilityLabel="In danger? Call 911" style={styles.full}>
        <Card tone="danger" style={{ paddingVertical: 12 }}>
          <Text style={{ fontSize: 14, color: theme.text }}>
            <Text style={{ fontWeight: '700', color: theme.red }}>In danger? Call 911. </Text>
            It works without data.
          </Text>
        </Card>
      </Pressable>
    </ResidentScreen>
  );
}

function SentScreen() {
  const theme = useTheme();
  const { id, number, method } = useLocalSearchParams<{ id: string; number: string; method?: string }>();
  // Sent without an account: the code is on this device, never in the URL.
  const saved = useSavedRequests().data?.find((r) => r.id === id);
  const signedIn = useAuth().status === 'signedIn';

  // R6, once per device: the first request sent while signed in is when
  // asking for notifications makes sense.
  useEffect(() => {
    let live = true;
    shouldAskResident(signedIn).then((ask) => {
      if (ask && live) router.push('/help/notifications');
    });
    return () => {
      live = false;
    };
  }, [signedIn]);

  return (
    <ResidentScreen
      back={false}
      contentStyle={{ alignItems: 'center', paddingTop: 40 }}
      footer={<BigButton label="View my request" variant="outline" onPress={() => router.replace(`/help/request/${id}`)} />}
    >
      <View style={[styles.check, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name="checkmark" size={48} color={theme.accent} />
      </View>
      <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
        Request received
      </Text>
      <Text style={[styles.lede, { color: theme.textSecondary }]}>
        Reference #{number}. {firstContact(isContactMethod(method) ? method : null)}
      </Text>

      {saved ? (
        <Card style={styles.full}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>Your access code</Text>
          <Text style={[styles.code, { color: theme.text }]} selectable accessibilityLabel={`Access code ${saved.code.split('').join(' ')}`}>
            {saved.code}
          </Text>
          <Text style={{ fontSize: 13, color: theme.textSecondary }}>
            This phone remembers it. On another phone, use #{number} and this code under My requests to see updates.
          </Text>
        </Card>
      ) : null}

      {saved && pushSupported() ? <NotifyMe number={saved.number} code={saved.code} /> : null}

      <Card style={[styles.full, { gap: 14 }]}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>What happens next</Text>
        <Step done title="Received" detail="Just now" />
        <Step title="A worker reads it" detail={firstContact(isContactMethod(method) ? method : null)} />
        <Step title="Connected with help" detail="Shelter, food, rides and more" />
      </Card>
    </ResidentScreen>
  );
}

/**
 * Sent without an account: this phone can still hear when ComForce replies
 * (a push saying only "You have a new update", no sound). Asks iOS first.
 */
function NotifyMe({ number, code }: { number: number; code: string }) {
  const theme = useTheme();
  const [state, setState] = useState<'idle' | 'asking' | 'on' | 'off'>('idle');
  const ask = async () => {
    setState('asking');
    setState((await subscribeToRequest(number, code)) ? 'on' : 'off');
  };
  return (
    <Card style={[styles.full, { gap: 8 }]}>
      <Text style={[styles.cardTitle, { color: theme.text }]}>Get notified on this phone</Text>
      <Text style={{ fontSize: 13, color: theme.textSecondary }}>
        {state === 'on'
          ? 'You’ll get a notification when ComForce replies. It never shows your message on the lock screen.'
          : state === 'off'
            ? 'Notifications are off for ComForce. You can turn them on in Settings, or check back here.'
            : 'We’ll let you know when ComForce replies. The notification only says “You have a new update”.'}
      </Text>
      {state === 'on' ? null : state === 'off' ? (
        <Button label="Open Settings" variant="tinted" onPress={openSettings} />
      ) : (
        <Button label="Notify me" icon="notifications-outline" variant="tinted" loading={state === 'asking'} onPress={ask} />
      )}
    </Card>
  );
}

function Step({ title, detail, done = false }: { title: string; detail: string; done?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.step} accessible accessibilityLabel={`${title}, ${done ? 'done' : 'next'}. ${detail}`}>
      <View style={[styles.dot, { backgroundColor: done ? theme.accent : theme.fill }]}>
        {done ? <Ionicons name="checkmark" size={16} color={theme.onAccent} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: done ? theme.text : theme.textSecondary }}>{title}</Text>
        <Text style={{ fontSize: 13, color: theme.textSecondary }}>{detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  check: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  lede: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  full: { alignSelf: 'stretch' },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 3, fontVariant: ['tabular-nums'] },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
