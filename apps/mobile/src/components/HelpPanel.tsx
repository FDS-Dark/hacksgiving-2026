import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PublicRequest } from '@/api/types';
import { BigButton, Card, StatusChip, requestHeading, updatedAgo } from '@/components/resident';
import { useResidentRequests } from '@/services/requests';
import { useTheme } from '@/theme/tokens';

const OPEN = new Set(['new', 'in_progress', 'awaiting_resources']);

/**
 * The resident home's "get help" block (Figma A1): Get help now, My
 * requests, the 911 card and the latest open request. On the signed-in
 * home and on the landing page, so nobody has to sign in during an emergency.
 */
export function HelpPanel({ heading = true }: { heading?: boolean }) {
  const theme = useTheme();
  const { requests } = useResidentRequests();
  const open = requests.find((r) => OPEN.has(r.status));

  return (
    <View style={styles.panel}>
      {heading ? (
        <>
          <Text style={[styles.title, { color: theme.text }]} accessibilityRole="header">
            Need help? We’re here.
          </Text>
          <Text style={[styles.lede, { color: theme.textSecondary }]}>
            Tell us what’s going on and a ComForce worker will reach out. It’s free and private.
          </Text>
        </>
      ) : null}
      <BigButton label="Get help now" onPress={() => router.push('/help')} />
      <BigButton label="My requests" variant="outline" onPress={() => router.push('/help/requests')} />
      <Card tone="danger">
        <View style={styles.row}>
          <Ionicons name="warning-outline" size={18} color={theme.red} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: theme.red }}>In danger right now?</Text>
        </View>
        <Text style={{ fontSize: 14, color: theme.text }}>Call 911 first. Then send a request so we can follow up.</Text>
      </Card>
      {open ? <RequestCard request={open} label="Your open request" /> : null}
    </View>
  );
}

/** A request in a list: what it's about, its number and status. */
export function RequestCard({ request, label }: { request: PublicRequest; label?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/help/request/${request.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${label ? `${label}: ` : ''}${requestHeading(request)}`}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      <Card style={{ gap: 10 }}>
        {label ? <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary }}>{label}</Text> : null}
        <Text style={{ fontSize: 17, fontWeight: '700', color: theme.text }}>{requestHeading(request)}</Text>
        <View style={styles.row}>
          <StatusChip status={request.status} />
          <Text style={{ fontSize: 13, color: theme.textSecondary }}>{updatedAgo(request.updated_at)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 18 },
  title: { fontSize: 30, fontWeight: '800' },
  lede: { fontSize: 16, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});
