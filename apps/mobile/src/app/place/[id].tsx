import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import type { Resource } from '@/api/types';
import { BigButton, Card, ResidentScreen, SampleTag } from '@/components/resident';
import { Button, ErrorBanner, Loading, type IconName } from '@/components/ui';
import { CATEGORY_ICON, CATEGORY_LABEL } from '@/lib/cases';
import { useResource } from '@/services/resources';
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

      <Card style={{ gap: 0, paddingVertical: 0 }}>
        {r.hours ? <Fact icon="time-outline" text={r.hours} /> : null}
        {r.address ? <Fact icon="location-outline" text={[r.address, r.neighborhood].filter(Boolean).join(' · ')} /> : null}
        {r.phone ? <Fact icon="call-outline" text={r.phone} /> : null}
        {r.website ? <Fact icon="globe-outline" text={r.website} onPress={() => Linking.openURL(r.website!)} /> : null}
      </Card>

      {r.description ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.section, { color: theme.text }]}>What to know</Text>
          <Text style={[styles.body, { color: theme.textSecondary }]}>{r.description}</Text>
        </View>
      ) : null}
    </View>
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
});
