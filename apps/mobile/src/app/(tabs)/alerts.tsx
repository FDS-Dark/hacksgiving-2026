import { useMemo } from 'react';

import { Button, EmptyState, Group, Header, Loading, Notice, Row, Screen, Txt } from '@/components/ui';
import { useDeviceLocation } from '@/services/deviceLocation';
import { INCIDENT_CATEGORIES, type SafetyPoint, usePublicSafetyPoints } from '@/services/publicSafety';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';

function categoryLabel(point: SafetyPoint) {
  if (point.category === 'community-report') return 'Community report';
  return INCIDENT_CATEGORIES.find((item) => item.id === point.category)?.label ?? 'Reported incident';
}

function ageLabel(days: number | undefined) {
  if (days === undefined) return 'Within the past 30 days';
  if (days <= 0) return 'Reported today';
  if (days === 1) return 'Reported yesterday';
  return `Reported ${days} days ago`;
}

function distanceLabel(point: SafetyPoint | (SafetyPoint & { distance: number })) {
  return 'distance' in point && typeof point.distance === 'number' ? `${point.distance.toFixed(1)} mi` : undefined;
}

export default function AlertsScreen() {
  const calls = useRecentCalls();
  const safety = usePublicSafetyPoints();
  const device = useDeviceLocation();

  const recentIncidents = useMemo(
    () => safety.points
      .filter((point) => point.category !== 'community-report')
      .sort((a, b) => (a.ageInDays ?? 31) - (b.ageInDays ?? 31))
      .slice(0, 8),
    [safety.points],
  );

  const nearbyIncidents = useMemo(() => {
    if (!device.location) return [];
    return safety.points
      .filter((point) => point.category !== 'community-report')
      .map((point) => ({ ...point, distance: milesBetween(device.location!, point) }))
      .filter((point) => point.distance <= 5)
      .sort((a, b) => a.distance - b.distance || (a.ageInDays ?? 31) - (b.ageInDays ?? 31))
      .slice(0, 10);
  }, [device.location, safety.points]);

  const refresh = () => {
    calls.refetch();
    safety.refetch();
  };

  return (
    <Screen refreshing={calls.isRefetching || safety.isRefetching} onRefresh={refresh}>
      <Header title="Safety alerts" subtitle="Visible updates from Milwaukee’s official public incident and dispatch feeds." />

      <Notice icon="information-circle-outline">
        Dispatch calls are delayed 30–90 minutes and are not confirmed crimes. Incident locations and distances are approximate.
      </Notice>

      {!device.location ? (
        <>
          <Button
            label="Sort alerts by my location"
            icon="navigate-outline"
            size="lg"
            loading={device.loading}
            onPress={device.locate}
          />
          <Txt variant="footnote" tone="secondary" style={{ textAlign: 'center' }}>
            Optional: your location stays on this device and is used only to calculate distance.
          </Txt>
          {device.error ? <Notice icon="location-outline" tone="warning">{device.error}</Notice> : null}
        </>
      ) : null}

      {safety.isPending ? (
        <Loading label="Loading recent incidents" />
      ) : (
        <Group
          header={device.location ? `Closest recent incidents · within 5 miles` : 'Latest reported incidents'}
          footer="These are generalized MPD incident records from the past 30 days, not predictions or risk scores."
        >
          {(device.location ? nearbyIncidents : recentIncidents).map((point) => (
            <Row
              key={point.id}
              title={`${categoryLabel(point)} reported nearby`}
              subtitle={`${ageLabel(point.ageInDays)} · generalized location`}
              detail={distanceLabel(point)}
              detailTint="rgba(180,35,24,0.09)"
              detailColor="#B42318"
              tile={{ icon: 'map-marker-alert', color: '#B42318' }}
            />
          ))}
        </Group>
      )}

      {calls.error ? (
        <Notice icon="cloud-offline-outline" tone="warning">
          The live city dispatch feed is unavailable right now. Historical incident alerts above are still available.
        </Notice>
      ) : calls.isPending ? (
        <Loading label="Checking the live dispatch feed" />
      ) : calls.data?.length ? (
        <Group
          header={`Live dispatch feed · ${calls.data.length}`}
          footer="Updated every five minutes while the app is open. Exact addresses are intentionally not displayed."
        >
          {calls.data.slice(0, 8).map((call) => (
            <Row
              key={call.id}
              title={call.nature}
              subtitle={`Police call · District ${call.district} · ${call.occurredAt}`}
              detail={call.status === 'Service in Progress' ? 'Active' : 'Updated'}
              detailTint="rgba(215,107,24,0.12)"
              detailColor="#9A5800"
              tile={{ icon: 'phone-alert', color: '#D76B18' }}
            />
          ))}
        </Group>
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No matching live calls"
          body="The city feed currently has no coordinate-safe calls in the selected safety categories. Pull down to check again."
          action={<Button label="Refresh" variant="tinted" onPress={refresh} />}
        />
      )}

      <Group header="Important">
        <Row
          title="Emergency? Call 911"
          subtitle="Do not rely on this app when you or someone else needs immediate help."
          tile={{ icon: 'shield-alert', color: '#B42318' }}
        />
      </Group>
    </Screen>
  );
}
