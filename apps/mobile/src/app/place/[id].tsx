import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import type { Resource } from '@/api/types';
import { BigButton, Card, Input, ResidentScreen, SampleTag } from '@/components/resident';
import { Button, ErrorBanner, Loading, success, type IconName } from '@/components/ui';
import { bedsLabel } from '@/lib/beds';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/cases';
import { sourceLabel, useTransitNearby } from '@/services/publicData';
import { useResource, useSetBeds } from '@/services/resources';
import { useIsStaff } from '@/services/staff';
import { space, useTheme } from '@/theme/tokens';
import { callPhone } from '@/lib/phone';

function directionsUrl(address: string) {
  const q = encodeURIComponent(`${address}, Milwaukee, WI`);
  return Platform.OS === 'ios' ? `maps://?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Figma R4 "Place details": call, get directions, or ask ComForce for a ride there. */
export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const place = useResource(id);

  if (place.isPending) return <ResidentScreen><Loading label="Loading this place" /></ResidentScreen>;
  if (place.error) {
    return (
      <ResidentScreen>
        <ErrorBanner error={place.error} onRetry={() => place.refetch()} />
      </ResidentScreen>
    );
  }
  const r = place.data;
  const ride = `I need a ride to ${r.name}${r.address ? `, ${r.address}` : ''}.`;

  return (
    <ResidentScreen
      footer={<BigButton label="Ask ComForce for a ride here" onPress={() => router.push({ pathname: '/help', params: { description: ride } })} />}
    >
      <PlaceBody place={r} />
    </ResidentScreen>
  );
}

function PlaceBody({ place: r }: { place: Resource }) {
  const theme = useTheme();
  const transit = useTransitNearby(r.latitude, r.longitude);
  const nearestStop = transit.data?.stops[0];
  const nextArrival = nearestStop?.arrivals[0];
  const isStaff = useIsStaff();
  const beds = bedsLabel(r);
  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: theme.fill }]}>
          <Ionicons name={CATEGORY_ICON[r.category]} size={28} color={theme.accent} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.name, { color: theme.text }]} accessibilityRole="header">
            {r.name}
          </Text>
          <View style={styles.row}>
            <Text style={[styles.meta, { color: theme.accent }]}>{CATEGORY_LABEL[r.category]}</Text>
            {r.is_sample ? <SampleTag /> : null}
          </View>
        </View>
      </View>

      <View style={styles.row}>
        {r.phone ? (
          <View style={{ flex: 1 }}>
            <Button label="Call" icon="call-outline" variant="tinted" onPress={() => callPhone(r.phone!)} />
          </View>
        ) : null}
        {r.address ? (
          <View style={{ flex: 1 }}>
            <Button label="Directions" icon="navigate-outline" variant="tinted" onPress={() => Linking.openURL(directionsUrl(r.address!))} />
          </View>
        ) : null}
      </View>

      {isStaff ? <BedsEditor place={r} /> : null}

      <Card style={{ gap: 0, paddingVertical: 0 }}>
        {beds ? <Fact icon="bed-outline" text={beds} /> : null}
        {r.hours ? <Fact icon="time-outline" text={r.hours} /> : null}
        {r.address ? <Fact icon="location-outline" text={[r.address, r.neighborhood].filter(Boolean).join(' · ')} /> : null}
        {r.phone ? <Fact icon="call-outline" text={r.phone} /> : null}
        {r.website ? <Fact icon="globe-outline" text={r.website} onPress={() => Linking.openURL(r.website!)} /> : null}
      </Card>

      {r.latitude != null && r.longitude != null ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.section, { color: theme.text }]}>Getting there by bus</Text>
          <Card style={{ gap: 0, paddingVertical: 0 }}>
            {transit.isPending ? <Fact icon="bus-outline" text="Checking nearby MCTS service…" /> : null}
            {transit.error ? <Fact icon="alert-circle-outline" text="Bus times can’t load right now." /> : null}
            {nearestStop ? (
              <>
                <Fact
                  icon="bus-outline"
                  text={`${nearestStop.name} · ${nearestStop.distance_m < 1000 ? `${Math.round(nearestStop.distance_m)} m away` : `${(nearestStop.distance_m / 1609).toFixed(1)} mi away`}`}
                />
                {nearestStop.routes.length ? <Fact icon="git-branch-outline" text={`Routes ${nearestStop.routes.join(', ')}`} /> : null}
                <Fact
                  icon="time-outline"
                  text={nextArrival
                    ? `${nextArrival.route_name ?? nextArrival.route_id} arrives in ${Math.max(0, nextArrival.minutes)} min${transit.data?.arrivals_live ? ' · live' : ' · scheduled'}`
                    : 'No upcoming arrival is listed.'}
                />
                {transit.data?.alerts.length ? (
                  <Fact icon="warning-outline" text={`${transit.data.alerts.length} active service alert${transit.data.alerts.length === 1 ? '' : 's'}`} />
                ) : null}
              </>
            ) : transit.data ? <Fact icon="walk-outline" text="No MCTS stop was found within about half a mile." /> : null}
          </Card>
          {transit.data ? <Text style={[styles.provenance, { color: theme.textSecondary }]}>{transit.data.attribution}</Text> : null}
        </View>
      ) : null}

      {r.description ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.section, { color: theme.text }]}>What to know</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{r.description}</Text>
        </View>
      ) : null}

      <Text style={[styles.provenance, { color: theme.textSecondary }]}>
        Resource source: {r.source === 'manual' ? 'ComForce staff' : sourceLabel(r.source)}{r.is_sample ? ' · sample listing' : ''}
      </Text>
    </View>
  );
}

/**
 * Staff only: tonight's open beds. Residents see the count for 24 hours,
 * so a worker who just called the shelter updates it here.
 */
function BedsEditor({ place: r }: { place: Resource }) {
  const theme = useTheme();
  const setBeds = useSetBeds(r.id);
  const [value, setValue] = useState(r.beds_available == null ? '' : String(r.beds_available));
  const parsed = value.trim() === '' ? null : Number(value);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000);
  return (
    <Card style={{ gap: space.sm }}>
      <Text style={[styles.section, { color: theme.text }]}>Open beds tonight</Text>
      <Text style={[styles.meta, { color: theme.textSecondary, fontWeight: '400' }]}>
        Staff only. Residents see this on Nearby for 24 hours. Leave it empty if you don’t know.
      </Text>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Input label="Beds" value={value} onChangeText={setValue} keyboardType="number-pad" maxLength={5} placeholder="Unknown" />
        </View>
        <View style={{ alignSelf: 'flex-end' }}>
          <Button
            label={setBeds.isSuccess && !setBeds.isPending ? 'Saved' : 'Save'}
            icon="checkmark"
            disabled={!valid}
            loading={setBeds.isPending}
            onPress={() => setBeds.mutate(parsed, { onSuccess: () => success() })}
          />
        </View>
      </View>
      {setBeds.error ? <ErrorBanner error={setBeds.error} /> : null}
    </Card>
  );
}

function Fact({ icon, text, onPress }: { icon: IconName; text: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.fact, { borderBottomColor: theme.separator }]}>
      <Ionicons name={icon} size={18} color={theme.accent} />
      <Text
        onPress={onPress}
        accessibilityRole={onPress ? 'link' : undefined}
        style={[styles.body, { color: onPress ? theme.accent : theme.text, flex: 1 }]}
        selectable
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 22, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  meta: { fontSize: 13, fontWeight: '700' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  section: { fontSize: 15, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21 },
  provenance: { fontSize: 12, lineHeight: 17 },
});
