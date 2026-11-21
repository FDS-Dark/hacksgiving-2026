import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { PublicRequestDetail } from '@/api/types';
import { Page } from '@/components/Page';
import { StatusPill } from '@/components/StatusPill';
import { RedRule } from '@/components/brand';
import { Button, ErrorBanner, Loading } from '@/components/ui';
import { SERVICE_INFO, STATUS_INFO, formatWhen } from '@/lib/requests';
import { useMyRequest } from '@/services/cases';
import { radius, space, useTheme } from '@/theme/tokens';

/** One of the member's requests: where it stands and what ComForce has shared. */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useMyRequest(id);

  return (
    <Page refreshing={detail.isRefetching} onRefresh={() => detail.refetch()} contentStyle={{ maxWidth: 820 }}>
      <Button label="All my requests" variant="plain" icon="chevron-back" onPress={() => router.navigate('/help')} style={{ alignSelf: 'flex-start' }} />
      {detail.isPending ? (
        <Loading label="Loading your request" />
      ) : detail.isError ? (
        <ErrorBanner error={detail.error} onRetry={() => detail.refetch()} />
      ) : (
        <Detail data={detail.data} />
      )}
    </Page>
  );
}

function Detail({ data: { request, updates } }: { data: PublicRequestDetail }) {
  const theme = useTheme();
  const service = SERVICE_INFO[request.category];
  const status = STATUS_INFO[request.status];
  // Newest first, like a message thread read top down.
  const timeline = [...updates].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.number, { color: theme.textTertiary }]}>Request #{request.number}</Text>
          <StatusPill status={request.status} />
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {request.title}
        </Text>
        <RedRule />
        <Text style={[styles.status, { color: theme.textSecondary }]}>{status.detail}</Text>

        <View style={[styles.routed, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name={service.icon} size={22} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.small, { color: theme.textSecondary }]}>Routed to</Text>
            <Text style={[styles.label, { color: theme.text }]}>{service.label}</Text>
          </View>
        </View>

        <Meta icon="time-outline" text={`Sent ${formatWhen(request.created_at)}`} />
        {request.location ? <Meta icon="location-outline" text={request.location} /> : null}
        {request.resolved_at ? <Meta icon="checkmark-done-outline" text={`Resolved ${formatWhen(request.resolved_at)}`} /> : null}

        <View style={{ gap: space.xs, marginTop: space.sm }}>
          <Text style={[styles.small, { color: theme.textSecondary }]}>What you told us</Text>
          <Text style={[styles.description, { color: theme.text }]} selectable>
            {request.description}
          </Text>
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Text accessibilityRole="header" style={[styles.label, { color: theme.text, fontSize: 19 }]}>
          Updates from ComForce
        </Text>
        {timeline.length === 0 ? (
          <Text style={[styles.small, { color: theme.textTertiary }]}>No updates yet. We will post here as your request moves along.</Text>
        ) : (
          timeline.map((u) => (
            <View key={u.id} style={[styles.update, { backgroundColor: theme.surface, borderColor: theme.separator, borderLeftColor: theme.accent }]}>
              <Text style={[styles.description, { color: theme.text }]}>{u.content}</Text>
              <Text style={[styles.small, { color: theme.textTertiary }]}>{formatWhen(u.created_at)}</Text>
            </View>
          ))
        )}
      </View>
    </>
  );
}

function Meta({ icon, text }: { icon: 'time-outline' | 'location-outline' | 'checkmark-done-outline'; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={16} color={theme.textSecondary} />
      <Text style={[styles.small, { color: theme.textSecondary, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  number: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  title: { fontSize: 26, lineHeight: 31, fontWeight: '900' },
  status: { fontSize: 16, lineHeight: 23 },
  routed: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.sm },
  label: { fontSize: 16, fontWeight: '800' },
  small: { fontSize: 13, lineHeight: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  description: { fontSize: 16, lineHeight: 23 },
  update: { gap: space.xs, padding: space.lg, borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.sm },
});
