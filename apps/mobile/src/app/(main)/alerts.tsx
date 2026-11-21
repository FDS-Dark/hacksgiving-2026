import { useMemo } from 'react';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { ResidentHeader } from '@/components/resident';
import { Button, EmptyState, Group, Loading, Notice, Row, Txt } from '@/components/ui';
import { useDeviceLocation } from '@/services/deviceLocation';
import { INCIDENT_CATEGORIES, type SafetyPoint, usePublicSafetyPoints } from '@/services/publicSafety';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';
import { useVoiceFollowUps } from '@/services/voice';

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
  };

  return (
    <Page refreshing={calls.isRefetching || safety.isRefetching} onRefresh={refresh}>
      <BackLink label="Back" fallback="/me" />
      <ResidentHeader title="Safety alerts" />

      <Notice icon="information-circle-outline">
        Dispatch calls are delayed 30–90 minutes and are not confirmed crimes. Incident locations and distances are approximate.
      </Notice>

      <Group
        header="Your ComForce notifications"
        footer="These private follow-ups are visible only while signed in. Connect your first call from the Account page."
      >
        {followUps.data?.length ? (
          followUps.data.map((item) => (
            <Row
              key={item.id}
              title={item.need_category?.replaceAll('-', ' ') ?? 'ComForce call follow-up'}
              subtitle={item.resources.length ? `Resources: ${item.resources.join(', ')}` : 'Your call is connected; resources can be added as the response progresses.'}
              detail={item.urgency_tier ?? 'new'}
              tile={{ icon: 'bell-ring', color: '#247A63' }}
            />
          ))
        ) : (
          <Row
            title="No call notifications yet"
            subtitle="Ask the phone assistant to connect your call, then enter its code under Account."
            tile={{ icon: 'phone-check', color: '#247A63' }}
          />
        )}
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
          footer="Safety-related calls from the last two hours, updated every five minutes. Locations are shown by block only."
        >
          {calls.data.slice(0, 8).map((call) => (
            <Row
              key={call.id}
              title={call.nature}
              subtitle={`${call.occurredAt} · ${call.block} · District ${call.district}`}
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
