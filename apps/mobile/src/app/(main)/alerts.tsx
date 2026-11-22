import { useMemo } from 'react';
import { Linking } from 'react-native';

import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, EmptyState, Group, Loading, Notice, Row, Txt } from '@/components/ui';
import { useDeviceLocation } from '@/services/deviceLocation';
import { INCIDENT_CATEGORIES, type SafetyPoint, usePublicSafetyPoints } from '@/services/publicSafety';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';
import { useWeatherAlerts } from '@/services/weather';
import { dateTime } from '@/lib/format';

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
  const weather = useWeatherAlerts();

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
    weather.refetch();
  };

  return (
    <Page header={<ResidentHeader title="Safety alerts" back="/safety" />} refreshing={calls.isRefetching || safety.isRefetching} onRefresh={refresh}>
      <Notice icon="information-circle-outline">
        These calls may be 30–90 minutes old. A call does not mean a crime happened. Locations and distances are approximate.
      </Notice>

      {weather.active.length ? (
        <Group header="Weather" footer="From the National Weather Service for Milwaukee County.">
          {weather.active.map((alert) => (
            <Row
              key={alert.id}
              title={alert.event}
              subtitle={alert.instruction ?? alert.headline ?? alert.description}
              detail={alert.expires_at ? `Until ${dateTime(alert.expires_at)}` : undefined}
              detailTint="rgba(154,88,0,0.10)"
              detailColor="#9A5800"
              tile={{ icon: 'weather-cloudy-alert', color: '#9A5800' }}
              onPress={alert.url ? () => Linking.openURL(alert.url!) : undefined}
            />
          ))}
        </Group>
      ) : null}

      {!device.location ? (
        <>
          <Button
            label="Show alerts near me"
            icon="navigate-outline"
            size="lg"
            loading={device.loading}
            onPress={device.locate}
          />
          <Txt variant="footnote" tone="secondary" style={{ textAlign: 'center' }}>
            Optional. Your location stays on this phone. We use it only to measure distance.
          </Txt>
          {device.error ? <Notice icon="location-outline" tone="warning">{device.error}</Notice> : null}
        </>
      ) : null}

      {safety.isPending ? (
        <Loading label="Loading recent incidents" />
      ) : (
        <Group
          header={device.location ? `Closest recent incidents · within 5 miles` : 'Latest reported incidents'}
          footer="Police-reviewed reports from the past 30 days. They do not predict what will happen."
        >
          {(device.location ? nearbyIncidents : recentIncidents).map((point) => (
            <Row
              key={point.id}
              title={`${categoryLabel(point)} reported nearby`}
              subtitle={`${ageLabel(point.ageInDays)} · approximate location`}
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
          Recent public safety calls can’t load right now. The reports above still work.
        </Notice>
      ) : calls.isPending ? (
        <Loading label="Checking recent public safety calls" />
      ) : calls.data?.length ? (
        <Group
          header={`Recent public safety calls · ${calls.data.length}`}
          footer="Calls from the last six hours. They may be 30–90 minutes old. The app checks every 30 seconds. Locations are approximate."
        >
          {calls.data.slice(0, 8).map((call) => (
            <Row
              key={call.id}
              title={call.nature}
              subtitle={`${call.occurredAt} · District ${call.district}`}
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
          title="No recent calls like these"
          body="No weapon, violence or property calls in the last six hours. Pull down to check again."
          action={<Button label="Refresh" variant="tinted" onPress={refresh} />}
        />
      )}

      <Group header="Important">
        <Row
          title="Emergency? Call 911"
          subtitle="If you or someone else needs help right now, call 911. Do not wait for this app."
          tile={{ icon: 'shield-alert', color: '#B42318' }}
        />
      </Group>
    </Page>
  );
}
