import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SafetyMap, type AreaSelection } from '@/components/SafetyMap';
import { Button, Chip, Chips, EmptyState, Field, Group, Header, Notice, Row, Screen, Sheet, Txt, success } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  INCIDENT_CATEGORIES,
  type IncidentCategory,
  type SafetyPoint,
  usePublicSafetyPoints,
} from '@/services/publicSafety';
import { useRecentCalls } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

const REPORT_COLOR = '#247A63';
const NEIGHBORHOODS = [
  { name: 'Near West Side', latitude: 43.04, longitude: -87.95 },
  { name: 'North Side', latitude: 43.1, longitude: -87.95 },
  { name: 'South Side', latitude: 42.99, longitude: -87.93 },
  { name: 'East Side', latitude: 43.06, longitude: -87.89 },
];

export default function HomeScreen() {
  const theme = useTheme();
  const { signOut } = useAuth();
  const safety = usePublicSafetyPoints();
  const calls = useRecentCalls();
  const [active, setActive] = useState<Set<IncidentCategory | 'community-report'>>(
    () => new Set([...INCIDENT_CATEGORIES.map((item) => item.id), 'community-report']),
  );
  const [reports, setReports] = useState<SafetyPoint[]>([]);
  const [selectedArea, setSelectedArea] = useState<AreaSelection | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState<IncidentCategory>('assault');
  const [neighborhood, setNeighborhood] = useState(NEIGHBORHOODS[0]);
  const [note, setNote] = useState('');

  const allPoints = useMemo(() => [...safety.points, ...reports], [reports, safety.points]);
  const visiblePoints = useMemo(() => allPoints.filter((point) => active.has(point.category)), [active, allPoints]);
  const updatedAt = safety.dataUpdatedAt ? new Date(safety.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Loading';
  const areaSummary = useMemo(() => {
    if (!selectedArea) return null;
    const counts = new Map<string, number>();
    for (const point of selectedArea.incidents) {
      const label = point.category === 'community-report'
        ? 'Community report'
        : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { total: selectedArea.incidents.length, breakdown, top: breakdown[0] };
  }, [selectedArea]);
  const refresh = () => {
    safety.refetch();
    calls.refetch();
  };

  const toggle = (id: IncidentCategory | 'community-report') => {
    setActive((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitReport = () => {
    setReports((current) => [{
      id: `community-${Date.now()}`,
      category: 'community-report',
      latitude: neighborhood.latitude,
      longitude: neighborhood.longitude,
      reportedCategory: category,
      note: note.trim() || undefined,
      source: 'Community report',
    }, ...current]);
    setActive((current) => new Set(current).add('community-report'));
    setNote('');
    setReportOpen(false);
    success();
  };

  return (
    <>
      <Screen refreshing={safety.isRefetching || calls.isRefetching} onRefresh={refresh}>
        <View style={styles.brandRow}>
          <View>
            <Txt variant="headline" color={theme.brand}>NearMKE</Txt>
            <Txt variant="caption" tone="secondary">Public safety & nearby help</Txt>
          </View>
          <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={10}>
            <Ionicons name="person-circle-outline" size={30} color={theme.textSecondary} />
          </Pressable>
        </View>

        <Header title="Know what’s nearby." subtitle="Explore recent public safety patterns and find trusted Milwaukee resources." />

        <Notice icon="warning-outline" tone="warning">
          For an emergency or immediate danger, call 911. This map is informational and is not monitored by emergency services.
        </Notice>

        <View style={{ gap: space.md }}>
          <View style={styles.sectionHeading}>
            <Txt variant="section">Recent activity</Txt>
            <Txt variant="footnote" tone="secondary">Updated {updatedAt}</Txt>
          </View>
          <Chips scroll>
            {INCIDENT_CATEGORIES.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                color={item.color}
                active={active.has(item.id)}
                count={allPoints.filter((point) => point.category === item.id).length}
                onPress={() => toggle(item.id)}
              />
            ))}
            <Chip
              label="Community"
              color={REPORT_COLOR}
              active={active.has('community-report')}
              count={reports.length}
              onPress={() => toggle('community-report')}
            />
          </Chips>
          <SafetyMap points={visiblePoints} recentCalls={calls.data ?? []} onSelectArea={setSelectedArea} />
          <Txt variant="footnote" tone="secondary">
            Tap anywhere on the heatmap to inspect recent reports within about 1.5 miles. Red markers are delayed police calls—not confirmed crimes. All locations are generalized.
          </Txt>
          {safety.isUsingFallback ? (
            <Notice icon="cloud-offline-outline">Live city data is unavailable, so sample locations are shown. Pull down to retry.</Notice>
          ) : null}
        </View>

        <Button label="Report nearby activity" icon="add-circle-outline" size="lg" onPress={() => setReportOpen(true)} />

        <Group
          header="Get help"
          footer="NearMKE only shows public-facing information. It does not expose case notes, identities, or internal partner records."
        >
          <Row
            title="Emergency services"
            subtitle="Immediate danger, medical emergency, or fire"
            detail="Call 911"
            tile={{ icon: 'phone-alert', color: '#B42318' }}
            accessory="chevron"
            onPress={() => Linking.openURL('tel:911')}
          />
          <Row
            title="Milwaukee 211"
            subtitle="Food, housing, health, and local support"
            detail="Call 211"
            tile={{ icon: 'hand-heart', color: theme.brand }}
            accessory="chevron"
            onPress={() => Linking.openURL('tel:211')}
          />
        </Group>
      </Screen>

      <Sheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report nearby activity"
        subtitle="Share only what neighbors need to stay aware. Reports stay on this device in the MVP."
        dismissLabel="Cancel"
      >
        <View style={{ gap: space.sm }}>
          <Txt variant="headline">What happened?</Txt>
          <Chips>
            {INCIDENT_CATEGORIES.map((item) => (
              <Chip key={item.id} label={item.label} color={item.color} active={category === item.id} onPress={() => setCategory(item.id)} />
            ))}
          </Chips>
        </View>

        <View style={{ gap: space.sm }}>
          <Txt variant="headline">General area</Txt>
          <Chips>
            {NEIGHBORHOODS.map((item) => (
              <Chip key={item.name} label={item.name} active={neighborhood.name === item.name} onPress={() => setNeighborhood(item)} />
            ))}
          </Chips>
        </View>

        <Field
          label="Optional note"
          value={note}
          onChangeText={setNote}
          placeholder="Brief, non-identifying context"
          maxLength={180}
          multiline
          style={styles.noteField}
        />

        <View style={[styles.privacyCard, { backgroundColor: theme.accentSoft }]}>
          <Ionicons name="shield-checkmark-outline" size={22} color={theme.accent} />
          <Txt variant="subhead" tone="secondary" style={{ flex: 1 }}>
            Do not include names, faces, license plates, exact home addresses, or private medical information. Reports are community observations, not verified facts.
          </Txt>
        </View>

        <Button label="Add generalized report" icon="location-outline" size="lg" onPress={submitReport} />
      </Sheet>

      <Sheet
        visible={selectedArea !== null}
        onClose={() => setSelectedArea(null)}
        title="Recent activity in this area"
        subtitle="Official public reports and dispatch calls within approximately 1.5 miles."
      >
        {areaSummary?.total || selectedArea?.calls.length ? (
          <>
            {areaSummary?.total ? (
              <>
                <Notice icon="analytics-outline">
                  This area appears warmer because {areaSummary.total} reports cluster near the selected point in the 30-day window
                  {areaSummary.top ? `; ${areaSummary.top[0]} is the largest category (${areaSummary.top[1]})` : ''}. This describes report density, not why crime occurs or whether an area is safe.
                </Notice>
                <Group header="Category breakdown">
                  {areaSummary.breakdown.map(([label, count]) => (
                    <Row key={label} title={label} detail={String(count)} />
                  ))}
                </Group>
                <Group header="Recent reported incidents" footer="Classifications may be revised. Exact addresses and incident numbers are intentionally omitted.">
                  {selectedArea?.incidents.map((point) => {
                    const categoryName = point.category === 'community-report'
                      ? 'Community report'
                      : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
                    const time = point.reportedAt
                      ? new Date(point.reportedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                      : point.ageInDays === 0
                        ? 'Reported today'
                        : point.ageInDays
                          ? `Reported ${point.ageInDays} days ago`
                          : 'Reported within 30 days';
                    return (
                      <Row
                        key={point.id}
                        title={categoryName}
                        subtitle={point.weaponUsed ? `${time} · Weapon detail: ${point.weaponUsed}` : time}
                        tile={{ icon: 'map-marker-alert', color: '#B42318' }}
                      />
                    );
                  })}
                </Group>
              </>
            ) : null}
            {selectedArea?.calls.length ? (
              <Group header="Recent dispatch calls" footer="Calls are delayed and unconfirmed; they are not counted in the heat intensity.">
                {selectedArea.calls.map((call) => (
                  <Row
                    key={call.id}
                    title={call.nature}
                    subtitle={`${call.occurredAt} · District ${call.district} · ${call.status}`}
                    tile={{ icon: 'phone-alert', color: '#D76B18' }}
                  />
                ))}
              </Group>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon="search-outline"
            title="No matching reports here"
            body="Try another nearby heat area or enable additional crime-category filters above the map."
          />
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  noteField: { minHeight: 84, textAlignVertical: 'top' },
  privacyCard: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.lg },
});
