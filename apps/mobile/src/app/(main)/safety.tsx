import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SafetyMap, type AreaSelection } from '@/components/SafetyMap';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, Chip, Chips, EmptyState, Field, Group, Notice, Row, Sheet, Txt, success } from '@/components/ui';
import {
  INCIDENT_CATEGORIES,
  type IncidentCategory,
  type SafetyWindowDays,
  type SafetyPoint,
  usePublicSafetyPoints,
} from '@/services/publicSafety';
import { CallSummary } from '@/components/CallSummary';
import { type CallCategory, type CallWindow, milesBetween, useCallFeed } from '@/services/recentCalls';
import { radius, space, useTheme } from '@/theme/tokens';
import { callPhone } from '@/lib/phone';

const REPORT_COLOR = '#247A63';
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

export default function SafetyScreen() {
  const theme = useTheme();
  const [windowDays, setWindowDays] = useState<SafetyWindowDays>(7);
  const [callWindow, setCallWindow] = useState<CallWindow>('6');
  const [callCategory, setCallCategory] = useState<CallCategory | null>(null);
  const [showReviewed, setShowReviewed] = useState(true);
  const [showMpdCalls, setShowMpdCalls] = useState(true);
  const [showMfdCalls, setShowMfdCalls] = useState(true);
  const safety = usePublicSafetyPoints(windowDays);
  const calls = useCallFeed(Number(callWindow), 'all');
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
  const visiblePoints = useMemo(() => allPoints.filter((point) => (
    active.has(point.category) && (point.category === 'community-report' || showReviewed)
  )), [active, allPoints, showReviewed]);
  const visibleCalls = useMemo(() => (calls.data?.calls ?? []).filter((call) => (
    (call.source === 'mfd_calls' ? showMfdCalls : showMpdCalls)
    && (!callCategory || call.category === callCategory)
  )), [calls.data, callCategory, showMfdCalls, showMpdCalls]);
  const updatedAt = safety.dataUpdatedAt ? new Date(safety.dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Loading';
  const allSelected = INCIDENT_CATEGORIES.every((item) => active.has(item.id));
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
      <Page header={<ResidentHeader title="Neighborhood awareness" />} refreshing={safety.isRefetching || calls.isRefetching} onRefresh={refresh}>
        <Txt variant="subhead" tone="secondary">Recent public safety calls. Locations are approximate.</Txt>
        <Group>
          <Row
            title="Safety alerts"
            subtitle="Weather warnings and reports near you"
            icon="notifications-outline"
            accessory="chevron"
            onPress={() => router.push('/alerts')}
          />
        </Group>

        <View style={{ gap: space.md }}>
          <View style={styles.sectionHeading}>
            <Txt variant="section">Recent activity</Txt>
            <Txt variant="footnote" tone="secondary">Updated {updatedAt}</Txt>
          </View>
          <Chips>
            <Chip label="Past 7 days" active={windowDays === 7} onPress={() => setWindowDays(7)} />
            <Chip label="30 days" active={windowDays === 30} onPress={() => setWindowDays(30)} />
            <Chip label="1 year" active={windowDays === 365} onPress={() => setWindowDays(365)} />
          </Chips>
          <View style={{ gap: space.sm }}>
            <Txt variant="headline">Map layers</Txt>
            <Chips>
              <Chip label="Reviewed incidents" color={theme.accent} active={showReviewed} onPress={() => setShowReviewed((value) => !value)} />
              <Chip label="Police calls" color="#D76B18" active={showMpdCalls} onPress={() => setShowMpdCalls((value) => !value)} />
              <Chip label="Fire & EMS" color="#B93815" active={showMfdCalls} onPress={() => setShowMfdCalls((value) => !value)} />
            </Chips>
          </View>
          <Chips scroll>
            <Chip label="All" active={allSelected} onPress={toggleAll} />
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
          <SafetyMap points={visiblePoints} recentCalls={visibleCalls} windowDays={windowDays} onSelectArea={setSelectedArea} />
          <Txt variant="footnote" tone="secondary">
            Tap the map to see reports within about 1.5 miles. Dark-ringed dots are public safety calls. They may be 30–90 minutes old, and a call does not mean a crime happened. All locations are approximate.
          </Txt>
          {safety.isUnavailable ? (
            <Notice icon="cloud-offline-outline">City incident data is unavailable right now, so the map is empty. Pull down to retry.</Notice>
          ) : (
            <Txt variant="footnote" tone="secondary">
              MPD-reviewed reported incidents · updated daily · may lag several weeks. Police calls are delayed 30–90 minutes; fire/EMS calls 15–105 minutes. Source: City of Milwaukee (CC BY).
            </Txt>
          )}
        </View>

        <CallSummary
          feed={calls.data}
          window={callWindow}
          onWindowChange={setCallWindow}
          selectedCategory={callCategory}
          onSelectCategory={(value) => {
            setCallCategory(value);
            if (value) {
              setShowMpdCalls(true);
              setShowMfdCalls(true);
            }
          }}
          loading={calls.isPending}
          error={calls.isError}
        />

        <Button label="Report something nearby" icon="add-circle-outline" size="lg" onPress={() => setReportOpen(true)} />

        <Notice icon="warning-outline" tone="warning">
          For an emergency or immediate danger, call 911. This map is informational and is not monitored by emergency services.
        </Notice>

        <Group
          header="Get help"
          footer="NearMKE shows only public information. It never shows case notes, names or partner records."
        >
          <Row
            title="Emergency services"
            subtitle="Immediate danger, medical emergency, or fire"
            detail="Call 911"
            tile={{ icon: 'phone-alert', color: '#B42318' }}
            accessory="chevron"
            onPress={() => callPhone('911')}
          />
          <Row
            title="Milwaukee 211"
            subtitle="Food, housing, health, and local support"
            detail="Call 211"
            tile={{ icon: 'hand-heart', color: theme.brand }}
            accessory="chevron"
            onPress={() => callPhone('211')}
          />
        </Group>
      </Page>

      <Sheet
        visible={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report something nearby"
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

        <Button label="Add report" icon="location-outline" size="lg" onPress={submitReport} />
      </Sheet>

      <Sheet
        visible={selectedArea !== null}
        onClose={() => setSelectedArea(null)}
        title="Recent activity in this area"
        subtitle="Public reports and public safety calls within about 1.5 miles."
      >
        {areaSummary?.total || selectedArea?.calls.length ? (
          <>
            {areaSummary?.total ? (
              <>
                <View style={[styles.areaSummary, { backgroundColor: theme.accentSoft }]}>
                  <Ionicons name="analytics-outline" size={24} color={theme.accent} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="headline">{areaSummary.total} reports in the past {windowDays === 365 ? 'year' : `${windowDays} days`}</Txt>
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
                  {selectedArea?.incidents.slice(0, 12).map((point) => {
                    const categoryName = point.category === 'community-report'
                      ? 'Community report'
                      : INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
                    const time = point.reportedAt
                      ? new Date(point.reportedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                      : point.ageInDays === 0
                        ? 'Reported today'
                        : point.ageInDays
                          ? `Reported ${point.ageInDays} days ago`
                          : `Reported within ${windowDays === 365 ? 'the past year' : `${windowDays} days`}`;
                    return (
                      <Row
                        key={point.id}
                        title={categoryName}
                        subtitle={point.weaponUsed ? `${time} · Weapon detail: ${point.weaponUsed}` : time}
                        detail={approximateDistance(selectedArea.center, point)}
                        tile={{ icon: 'map-marker-alert', color: '#B42318' }}
                      />
                    );
                  })}
                </Group>
              </>
            ) : null}
            {selectedArea?.calls.length ? (
              <Group header="Recent public safety calls" footer="These calls may be old, and a call does not mean a crime happened. They are not part of the heat map.">
                {selectedArea.calls.slice(0, 10).map((call) => (
                  <Row
                    key={call.id}
                    title={call.nature}
                    subtitle={`${call.occurredAt} · ${call.source === 'mfd_calls' ? 'MFD fire/EMS' : `MPD${call.district ? ` District ${call.district}` : ''}`} · ${call.status}`}
                    detail={approximateDistance(selectedArea.center, call)}
                    tile={{ icon: call.source === 'mfd_calls' ? 'fire-truck' : 'phone-alert', color: call.source === 'mfd_calls' ? '#B93815' : '#D76B18' }}
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
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  noteField: { minHeight: 84, textAlignVertical: 'top' },
  privacyCard: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.lg },
  areaSummary: { flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.md, borderRadius: radius.lg },
});
