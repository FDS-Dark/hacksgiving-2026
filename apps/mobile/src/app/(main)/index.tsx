import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CaseCategory, PublicRequest } from '@/api/types';
import { Page } from '@/components/Page';
import { Card, RequestProgress, StatusChip, ResidentHeader, isOpenStatus } from '@/components/resident';
import type { IconName } from '@/components/ui';
import { jobsLine, places, shelterLine } from '@/lib/homeCounts';
import { prefersCommunityView } from '@/lib/viewMode';
import { useOpportunities } from '@/services/opportunities';
import { usePendingRequests, useResidentRequest, useResidentRequests } from '@/services/requests';
import { useResources } from '@/services/resources';
import { useIsStaff } from '@/services/staff';
import { useMe } from '@/services/user';
import { needsShelter, useWeatherAlerts } from '@/services/weather';
import { radius, space, useTheme } from '@/theme/tokens';
import { callPhone } from '@/lib/phone';

/** The four "Find support" tiles on Home; each opens Nearby filtered to its category. */
const SUPPORT: { category: CaseCategory; label: string; icon: IconName }[] = [
  { category: 'homelessness', label: 'Shelter', icon: 'bed-outline' },
  { category: 'meal_programs', label: 'Meals', icon: 'restaurant-outline' },
  { category: 'transportation', label: 'Rides', icon: 'bus-outline' },
  { category: 'bridge_to_employment', label: 'Jobs & training', icon: 'briefcase-outline' },
];

/** Staff skip the resident home and land on their work (Figma "Today"), unless they switched views. */
export default function HomeRoute() {
  const isStaff = useIsStaff();
  if (isStaff && !prefersCommunityView()) return <Redirect href="/staff" />;
  return <HomeScreen />;
}

/** Figma "Step 3 · Resident · Home": getting help first, then your open request, then support nearby. */
function HomeScreen() {
  const theme = useTheme();
  const me = useMe();
  const list = useResidentRequests();
  const resources = useResources();
  const pending = usePendingRequests();
  const jobs = useOpportunities({});
  const open = list.requests.find((r) => isOpenStatus(r.status));
  const first = me.data?.display_name?.trim().split(/\s+/)[0];

  const inCategory = (category: CaseCategory) => (resources.data ?? []).filter((r) => r.category === category);
  const line = (category: CaseCategory) => {
    if (category === 'homelessness') return shelterLine(inCategory(category));
    if (category === 'bridge_to_employment' && jobs.data) return jobsLine(jobs.data);
    return places(inCategory(category).length);
  };

  return (
    <Page
      header={<ResidentHeader kicker="COMFORCE MKE" title={first ? `Hi, ${first}` : 'Hi there'} />}
      refreshing={list.isRefetching}
      onRefresh={() => {
        list.refetch();
        resources.refetch();
        jobs.refetch();
      }}
      contentStyle={{ maxWidth: 560, gap: space.lg }}
    >

      <Pressable onPress={() => router.push('/help')} accessibilityRole="button" accessibilityLabel="Get help now" style={({ pressed }) => pressed && { opacity: 0.8 }}>
        <Card style={{ gap: space.sm }}>
          <View style={styles.row}>
            <Ionicons name="help-buoy-outline" size={26} color={theme.accent} />
            <Text style={[styles.helpTitle, { color: theme.text }]}>Get help now</Text>
            <View style={[styles.go, { backgroundColor: theme.fill }]}>
              <Ionicons name="chevron-forward" size={18} color={theme.text} />
            </View>
          </View>
          <Text style={[styles.body, { color: theme.textSecondary }]}>
            Shelter tonight, food, a ride, or a safe place to talk. Tell us what is going on.
          </Text>
        </Card>
      </Pressable>

      <Pressable
        onPress={() => callPhone('911')}
        accessibilityRole="button"
        accessibilityLabel="In danger right now? Call 911"
        style={({ pressed }) => [styles.danger, { backgroundColor: theme.dangerSoft }, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="call-outline" size={16} color={theme.danger} />
        <Text style={[styles.dangerText, { color: theme.danger }]}>In danger right now? Call 911</Text>
        <Text style={[styles.dangerCall, { color: theme.danger }]}>Call</Text>
      </Pressable>

      <WeatherBanner />

      {pending.data?.length ? (
        <Card style={{ gap: 4 }}>
          <View style={styles.row}>
            <Ionicons name="cloud-offline-outline" size={18} color={theme.soon} />
            <Text style={[styles.weatherTitle, { color: theme.soon }]}>Queued to send</Text>
          </View>
          <Text style={[styles.small, { color: theme.textSecondary }]}>
            {pending.data.length === 1 ? 'Your request is' : `${pending.data.length} requests are`} saved on this phone and will send as soon as you have
            signal.
          </Text>
        </Card>
      ) : null}

      {open ? <OpenRequest request={open} /> : null}

      <View style={{ gap: space.sm }}>
        <View style={styles.row}>
          <Text style={[styles.section, { color: theme.text }]} accessibilityRole="header">
            Find support
          </Text>
          <Text onPress={() => router.replace('/nearby')} accessibilityRole="link" style={[styles.link, { color: theme.accent }]}>
            See all
          </Text>
        </View>
        <View style={styles.tiles}>
          {SUPPORT.map((s) => {
            const detail = line(s.category);
            // Jobs are postings, not places: that tile opens the listings.
            const open = () =>
              s.category === 'bridge_to_employment'
                ? router.push('/opportunities')
                : router.replace({ pathname: '/nearby', params: { category: s.category } });
            return (
              <Pressable
                key={s.category}
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={`${s.label}, ${detail}`}
                style={({ pressed }) => [styles.tile, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={s.icon} size={22} color={theme.accent} />
                <Text style={[styles.tileTitle, { color: theme.text }]}>{s.label}</Text>
                <Text style={[styles.small, { color: theme.textSecondary }]}>
                  {resources.isPending ? ' ' : detail}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Page>
  );
}

/**
 * The most severe National Weather Service alert in effect, if any. Opens
 * Safety alerts for the details. For cold or heat it also points to shelter,
 * since someone outside needs a warm or cool place tonight.
 */
function WeatherBanner() {
  const theme = useTheme();
  const { active } = useWeatherAlerts();
  const top = active[0];
  if (!top) return null;
  const more = active.length - 1;
  const heat = /heat/i.test(top.event);
  return (
    <View style={[styles.weather, { backgroundColor: theme.warningSoft }]}>
      <Pressable
        onPress={() => router.push('/alerts')}
        accessibilityRole="button"
        accessibilityLabel={`Weather alert: ${top.event}. Open safety alerts`}
        style={({ pressed }) => [{ gap: 4 }, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.row}>
          <Ionicons name={heat ? 'sunny-outline' : 'cloudy-outline'} size={18} color={theme.soon} />
          <Text style={[styles.weatherTitle, { color: theme.soon }]} numberOfLines={1}>
            {top.event}
          </Text>
          {more > 0 ? <Text style={[styles.small, { color: theme.soon }]}>+{more} more</Text> : null}
          <Ionicons name="chevron-forward" size={16} color={theme.soon} />
        </View>
        {top.headline ? (
          <Text style={[styles.small, { color: theme.text }]} numberOfLines={2}>
            {top.headline}
          </Text>
        ) : null}
      </Pressable>
      {needsShelter(top) ? (
        <Text
          onPress={() => router.replace({ pathname: '/nearby', params: { category: 'homelessness' } })}
          accessibilityRole="link"
          style={[styles.link, { color: theme.soon }]}
        >
          {heat ? 'Find a cool place to stay' : 'Find a warm place tonight'}
        </Text>
      ) : null}
    </View>
  );
}

/** "Your request" (Figma home card): status, progress, and the newest message from ComForce. */
function OpenRequest({ request }: { request: PublicRequest }) {
  const theme = useTheme();
  const detail = useResidentRequest(request.id);
  const message = [...(detail.data?.updates ?? [])].reverse().find((u) => u.update_type === 'message');
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/help/request/[id]', params: { id: request.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Your request #${request.number}: ${request.title}`}
      style={({ pressed }) => pressed && { opacity: 0.8 }}
    >
      <Card style={{ gap: 10 }}>
        <View style={styles.row}>
          <Text style={[styles.kicker, { color: theme.textSecondary }]}>YOUR REQUEST · #{request.number}</Text>
          <StatusChip status={request.status} />
        </View>
        <Text style={[styles.requestTitle, { color: theme.text }]} numberOfLines={2}>
          {request.title}
        </Text>
        <RequestProgress status={request.status} />
        {message ? (
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <Ionicons name="chatbubble-outline" size={14} color={theme.textSecondary} style={{ marginTop: 2 }} />
            <Text style={[styles.small, { color: theme.text, flex: 1 }]} numberOfLines={2}>
              {message.content}
            </Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'space-between' },
  helpTitle: { flex: 1, fontSize: 22, fontWeight: '800' },
  go: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { fontSize: 15, lineHeight: 21 },
  danger: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radius.md },
  dangerText: { fontSize: 14, fontWeight: '600', flex: 1 },
  dangerCall: { fontSize: 14, fontWeight: '800' },
  weather: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: 12, borderRadius: radius.md },
  weatherTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  section: { fontSize: 17, fontWeight: '800' },
  link: { fontSize: 14, fontWeight: '700' },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, flex: 1 },
  requestTitle: { fontSize: 18, fontWeight: '700' },
  small: { fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 6, padding: space.md, borderWidth: 1, borderRadius: 14 },
  tileTitle: { fontSize: 16, fontWeight: '700' },
});
