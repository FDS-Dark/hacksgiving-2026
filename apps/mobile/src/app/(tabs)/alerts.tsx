import { useMemo } from 'react';

import { Button, EmptyState, Group, Header, Notice, Row, Screen, Txt } from '@/components/ui';
import { useDeviceLocation } from '@/services/deviceLocation';
import { milesBetween, useRecentCalls } from '@/services/recentCalls';

export default function AlertsScreen() {
  const calls = useRecentCalls();
  const device = useDeviceLocation();
  const nearby = useMemo(() => {
    if (!device.location) return [];
    return (calls.data ?? [])
      .map((call) => ({ ...call, distance: milesBetween(device.location!, call) }))
      .filter((call) => call.distance <= 3)
      .sort((a, b) => a.distance - b.distance);
  }, [calls.data, device.location]);

  return (
    <Screen refreshing={calls.isRefetching} onRefresh={calls.refetch}>
      <Header title="Nearby alerts" subtitle="Recent police calls near your current location, refreshed every five minutes." />

      <Notice icon="information-circle-outline">
        Calls appear 30–90 minutes after dispatch and may be unverified, reclassified, or resolved. This is not an emergency notification service.
      </Notice>

      {calls.error ? (
        <Notice icon="cloud-offline-outline" tone="warning">
          The city calls feed is unavailable right now. Pull down to try again.
        </Notice>
      ) : null}

      {!device.location ? (
        <>
          <Button
            label="Find alerts near me"
            icon="navigate-outline"
            size="lg"
            loading={device.loading}
            onPress={device.locate}
          />
          <Txt variant="footnote" tone="secondary" style={{ textAlign: 'center' }}>
            Your precise location is used only on this device to calculate distance. It is not saved or sent to ComForce.
          </Txt>
          {device.error ? <Notice icon="location-outline" tone="warning">{device.error}</Notice> : null}
        </>
      ) : nearby.length ? (
        <Group
          header={`Within 3 miles · ${nearby.length}`}
          footer="Locations are rounded before they reach this screen. Tap and pull down to refresh the city feed."
        >
          {nearby.map((call) => (
            <Row
              key={call.id}
              title={call.nature}
              subtitle={`Police call · District ${call.district} · ${call.occurredAt}`}
              detail={`${call.distance.toFixed(1)} mi`}
              detailTint="rgba(180,35,24,0.09)"
              detailColor="#B42318"
              tile={{ icon: 'alert-outline', color: '#B42318' }}
            />
          ))}
        </Group>
      ) : (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No matching nearby calls"
          body="No location-tagged calls in the selected safety categories are currently listed within three miles. The feed is limited and delayed."
          action={<Button label="Refresh" variant="tinted" onPress={() => calls.refetch()} />}
        />
      )}

      <Group header="What these alerts mean">
        <Row
          title="Recent call, not confirmed crime"
          subtitle="The nature of a call describes what was dispatched, not a final investigation result."
          tile={{ icon: 'phone-alert', color: '#D76B18' }}
        />
        <Row
          title="Emergency? Call 911"
          subtitle="Do not rely on this app when you or someone else needs immediate help."
          tile={{ icon: 'shield-alert', color: '#B42318' }}
        />
      </Group>
    </Screen>
  );
}
