import { router } from 'expo-router';
import { useMemo } from 'react';
import { Linking } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, EmptyState, Group, Loading, Notice, Row, Txt } from '@/components/ui';
import { useDeviceLocation } from '@/services/deviceLocation';
import { INCIDENT_CATEGORIES, type SafetyPoint, usePublicSafetyPoints } from '@/services/publicSafety';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';
import { useVoiceFollowUps } from '@/services/voice';
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
  const followUps = useVoiceFollowUps();
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
    followUps.refetch();
    weather.refetch();
  };

  return (
    <Page refreshing={calls.isRefetching || safety.isRefetching} onRefresh={refresh}>
      <BackLink label="Back" fallback="/me" />
      <ResidentHeader title="Safety alerts" />

      <Notice icon="information-circle-outline">
        Dispatch calls are delayed 30–90 minutes and are not confirmed crimes. Incident locations and distances are approximate.
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

      {/* Phone-call follow-ups live in one place, Me > Phone calls; this row points there. */}
      <Group header="Your ComForce notifications">
        <Row
          title="Phone call follow-ups"
          subtitle={
            followUps.data?.length
              ? `${followUps.data.length} connected call${followUps.data.length === 1 ? '' : 's'} · under Me > Phone calls`
              : 'Connect a call with the phone assistant under Me > Phone calls.'
          }
          tile={{ icon: 'phone-check', color: '#247A63' }}
          accessory="chevron"
          onPress={() => router.push('/me')}
        />
      </Group>

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
          footer="Safety-related calls from the last six hours. Not live: MPD publishes calls 30–90 min after dispatch; the app checks every 30 seconds. Locations are approximate."
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
          title="No matching live calls"
          body="No weapon, violence or property calls in the last two hours. Pull down to check again."
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
    </Page>
  );
}
