import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { SafetyMap, type AreaSelection } from '@/components/SafetyMap';
import { Button, Chip, Chips, EmptyState, Field, Group, Notice, Row, Sheet, Txt, success } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  INCIDENT_CATEGORIES,
  type IncidentCategory,
  type SafetyPoint,
  usePublicSafetyPoints,
} from '@/services/publicSafety';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';

const REPORT_COLOR = '#247A63';
const FILTER_CATEGORIES = [
  ...['assault', 'theft', 'vehicle-theft', 'robbery'].map((id) => INCIDENT_CATEGORIES.find((item) => item.id === id)!),
  ...INCIDENT_CATEGORIES.filter((item) => !['assault', 'theft', 'vehicle-theft', 'robbery'].includes(item.id)),
];
const NEIGHBORHOODS = [
  { name: 'Near West Side', latitude: 43.04, longitude: -87.95 },
  { name: 'North Side', latitude: 43.1, longitude: -87.95 },
  { name: 'South Side', latitude: 42.99, longitude: -87.93 },
  { name: 'East Side', latitude: 43.06, longitude: -87.89 },
];

function approximateDistance(
  center: { latitude: number; longitude: number },
  point: { latitude?: number; longitude?: number },
) {
  if (point.latitude === undefined || point.longitude === undefined) return undefined;
  return `Approx. ${milesBetween(center, { latitude: point.latitude, longitude: point.longitude }).toFixed(1)} mi`;
}

function incidentLabel(point: SafetyPoint) {
  return point.category === 'community-report'
    ? 'Community report'
    : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
}

function incidentTime(point: SafetyPoint) {
  if (point.reportedAt) return new Date(point.reportedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  if (point.ageInDays === 0) return 'Reported today';
  return point.ageInDays ? `Reported ${point.ageInDays} days ago` : 'Reported within 30 days';
}

function incidentColor(point: SafetyPoint) {
  return point.category === 'community-report'
    ? REPORT_COLOR
    : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.color ?? '#5A6569';
}

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState<IncidentCategory>('assault');
  const [neighborhood, setNeighborhood] = useState(NEIGHBORHOODS[0]);
  const [note, setNote] = useState('');

  const allPoints = useMemo(() => [...safety.points, ...reports], [reports, safety.points]);
  const visiblePoints = useMemo(() => allPoints.filter((point) => active.has(point.category)), [active, allPoints]);
  const updatedAt = safety.dataUpdatedAt ? new Date(safety.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Loading';
  const allSelected = INCIDENT_CATEGORIES.every((item) => active.has(item.id));
  const defaultArea = useMemo<AreaSelection>(() => {
    const center = { latitude: 43.045, longitude: -87.95 };
    return {
      center,
      incidents: visiblePoints
        .filter((point) => point.category !== 'community-report' && milesBetween(center, point) <= 1.5)
        .sort((a, b) => (a.ageInDays ?? 31) - (b.ageInDays ?? 31)),
      calls: (calls.data ?? [])
        .filter((call) => call.latitude !== undefined && call.longitude !== undefined)
        .filter((call) => milesBetween(center, { latitude: call.latitude!, longitude: call.longitude! }) <= 1.5),
    };
  }, [calls.data, visiblePoints]);
  const currentArea = selectedArea ?? defaultArea;
  const areaSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of currentArea.incidents) {
      const label = point.category === 'community-report'
        ? 'Community report'
        : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const breakdown = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { total: currentArea.incidents.length, breakdown, top: breakdown[0] };
  }, [currentArea]);
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

  const toggleAll = () => {
    setActive((current) => {
      const next = new Set(current);
      if (allSelected) INCIDENT_CATEGORIES.forEach((item) => next.delete(item.id));
      else INCIDENT_CATEGORIES.forEach((item) => next.add(item.id));
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
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={safety.isRefetching || calls.isRefetching} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <View style={[styles.top, { backgroundColor: theme.surface }]}>
          <View style={styles.brandRow}>
            <View style={styles.brandTitle}>
              <Ionicons name="location-sharp" size={29} color={theme.brand} />
              <Txt variant="title" color={theme.brand}>NearMKE</Txt>
              <View style={[styles.brandDivider, { backgroundColor: theme.separator }]} />
              <Txt variant="title" style={{ flexShrink: 1 }}>Know what’s nearby.</Txt>
            </View>
            <Pressable onPress={signOut} accessibilityRole="button" accessibilityLabel="Sign out" hitSlop={10}>
              <Ionicons name="person-circle-outline" size={30} color={theme.textSecondary} />
            </Pressable>
          </View>

          <Chips scroll inset={space.lg}>
            <Chip label="All" active={allSelected} onPress={toggleAll} />
            {FILTER_CATEGORIES.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                color={item.color}
                active={active.has(item.id)}
                onPress={() => toggle(item.id)}
              />
            ))}
          </Chips>
        </View>

        <View style={styles.mapWrap}>
          <SafetyMap points={visiblePoints} recentCalls={calls.data ?? []} onSelectArea={setSelectedArea} />
          <View style={[styles.updatedPill, { backgroundColor: `${theme.surface}F2` }]} pointerEvents="none">
            <View style={[styles.liveDot, { backgroundColor: safety.isUsingFallback ? theme.soon : theme.fresh }]} />
            <Txt variant="caption" tone="secondary">Updated {updatedAt}</Txt>
          </View>
        </View>

        <View style={[styles.activityCard, { backgroundColor: theme.surface }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.textTertiary }]} />
          <Txt variant="title">Recent activity in this area</Txt>

          <View style={[styles.areaSummary, { backgroundColor: theme.accentSoft }]}>
            <View style={[styles.summaryIcon, { backgroundColor: theme.brand }]}>
              <Ionicons name="bar-chart" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="headline">{areaSummary.total} reports in the past 30 days</Txt>
              <Txt variant="subhead" tone="secondary">
                {areaSummary.top ? `Most common: ${areaSummary.top[0]} (${areaSummary.top[1]})` : 'No reports in this selected area'}
              </Txt>
            </View>
          </View>

          <View style={styles.disclaimerRow}>
            <Ionicons name="information-circle-outline" size={21} color={theme.textSecondary} />
            <Txt variant="footnote" tone="secondary" style={{ flex: 1 }}>
              Density reflects reported incidents, not whether an area is safe.
            </Txt>
          </View>

          <View style={[styles.activityRows, { borderColor: theme.separator }]}>
            {currentArea.incidents.slice(0, 3).map((point) => (
              <Row
                key={point.id}
                title={incidentLabel(point)}
                subtitle={`${incidentTime(point)}  ·  ${approximateDistance(currentArea.center, point)}`}
                tile={{ icon: 'map-marker-alert', color: incidentColor(point) }}
                accessory="chevron"
                onPress={() => setDetailsOpen(true)}
              />
            ))}
            {!currentArea.incidents.length ? (
              <EmptyState icon="search-outline" title="No reports selected" body="Tap another heat area or enable more categories." />
            ) : null}
          </View>

          <View style={styles.panelActions}>
            <Button label="See all nearby activity" icon="list-outline" onPress={() => setDetailsOpen(true)} />
            <Button label="Report activity" icon="add-circle-outline" onPress={() => setReportOpen(true)} />
          </View>
        </View>

        <View style={styles.supportingContent}>
          {safety.isUsingFallback ? (
            <Notice icon="cloud-offline-outline">Live city data is unavailable, so sample locations are shown. Pull down to retry.</Notice>
          ) : null}
          <Notice icon="warning-outline" tone="warning">
            For an emergency or immediate danger, call 911. This map is informational and is not monitored by emergency services.
          </Notice>
          <Group
            header="Get help"
            footer="NearMKE shows public-facing information only—never identities, case notes, or internal partner records."
          >
            <Row title="Emergency services" subtitle="Immediate danger, medical emergency, or fire" detail="Call 911" tile={{ icon: 'phone-alert', color: '#B42318' }} accessory="chevron" onPress={() => Linking.openURL('tel:911')} />
            <Row title="Milwaukee 211" subtitle="Food, housing, health, and local support" detail="Call 211" tile={{ icon: 'hand-heart', color: theme.brand }} accessory="chevron" onPress={() => Linking.openURL('tel:211')} />
          </Group>
        </View>
      </ScrollView>

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
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Recent activity in this area"
        subtitle="Official public reports and dispatch calls within approximately 1.5 miles."
      >
        {areaSummary.total || currentArea.calls.length ? (
          <>
            {areaSummary.total ? (
              <>
                <View style={[styles.areaSummary, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name="analytics-outline" size={24} color={theme.accent} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="headline">{areaSummary.total} reports in the past 30 days</Txt>
                    {areaSummary.top ? (
                      <Txt variant="subhead" tone="secondary">Most common: {areaSummary.top[0]} ({areaSummary.top[1]})</Txt>
                    ) : null}
                  </View>
                </View>
                <Txt variant="footnote" tone="secondary">
                  Higher heat means more public reports overlap here. It does not explain why incidents occur or predict whether an area is safe.
                </Txt>
                <Group header="Category breakdown">
                  {areaSummary.breakdown.map(([label, count]) => (
                    <Row key={label} title={label} detail={String(count)} />
                  ))}
                </Group>
                <Group header="Recent reported incidents" footer="Classifications may be revised. Exact addresses and incident numbers are intentionally omitted.">
                  {currentArea.incidents.slice(0, 12).map((point) => {
                    const categoryName = incidentLabel(point);
                    const time = incidentTime(point);
                    return (
                      <Row
                        key={point.id}
                        title={categoryName}
                        subtitle={point.weaponUsed ? `${time} · Weapon detail: ${point.weaponUsed}` : time}
                        detail={approximateDistance(currentArea.center, point)}
                        tile={{ icon: 'map-marker-alert', color: '#B42318' }}
                      />
                    );
                  })}
                </Group>
              </>
            ) : null}
            {currentArea.calls.length ? (
              <Group header="Recent dispatch calls" footer="Calls are delayed and unconfirmed; they are not counted in the heat intensity.">
                {currentArea.calls.slice(0, 10).map((call) => (
                  <Row
                    key={call.id}
                    title={call.nature}
                    subtitle={`${call.occurredAt} · District ${call.district} · ${call.status}`}
                    detail={approximateDistance(currentArea.center, call)}
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
  top: { paddingTop: space.md, paddingBottom: space.md, gap: space.lg },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1, paddingLeft: space.lg },
  brandDivider: { width: 1, height: 28, marginHorizontal: space.xs },
  mapWrap: { position: 'relative' },
  updatedPill: { position: 'absolute', top: space.sm, left: space.sm, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  activityCard: { marginTop: -34, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl, gap: space.lg, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: -5 }, elevation: 9 },
  sheetHandle: { width: 46, height: 5, borderRadius: 3, alignSelf: 'center', opacity: 0.6 },
  summaryIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  disclaimerRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingHorizontal: space.sm },
  activityRows: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  panelActions: { gap: space.sm },
  supportingContent: { padding: space.lg, gap: space.xl },
  noteField: { minHeight: 84, textAlignVertical: 'top' },
  privacyCard: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.lg },
  areaSummary: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md, borderRadius: radius.lg },
});
