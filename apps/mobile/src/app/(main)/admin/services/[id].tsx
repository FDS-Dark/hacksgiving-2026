import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { Picker, Section } from '@/components/admin/form';
import { Badge } from '@/components/admin/requestBits';
import { ServiceStatusBadge } from '@/components/admin/serviceBits';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { ChartCard, StatTile } from '@/components/charts/ChartCard';
import { LineChart } from '@/components/charts/LineChart';
import { Page } from '@/components/Page';
import { Button, Chip, Chips, EmptyState, Group, Notice, Row, Txt, success } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { REFERRAL_LABEL } from '@/lib/requests';
import {
  PARTNER_STATUS_LABEL,
  STALE_DAYS,
  connectRate,
  daysSince,
  isStale,
  isoDay,
  series,
  usage,
  type EventKind,
  type PartnerStatus,
} from '@/lib/services';
import { useChartTheme } from '@/theme/chart';
import { space, useTheme } from '@/theme/tokens';

/** One service: how to reach it, how much it's used, referrals to it, and our relationship. */
export default function ServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const chart = useChartTheme();
  const { services, serviceEvents, requests, saveService, removeService, trackServiceEvent } = useAdmin();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const s = services.find((x) => x.id === id);

  const use = useMemo(() => usage(serviceEvents, days), [serviceEvents, days]);
  const trend = useMemo(() => series(serviceEvents, days, id), [serviceEvents, days, id]);

  if (!s) {
    return (
      <Page>
        <BackLink label="Services" href="/admin/services" />
        <EmptyState icon="search-outline" title="Service not found" body="It may have been removed." />
      </Page>
    );
  }

  if (editing) {
    return (
      <Page contentStyle={{ maxWidth: 820 }}>
        <BackLink label={s.name} onPress={() => setEditing(false)} />
        <ServiceForm
          initial={s}
          isNew={false}
          onCancel={() => setEditing(false)}
          onSave={(next) => {
            success();
            saveService(next);
            setEditing(false);
          }}
        />
      </Page>
    );
  }

  const c = use.get(s.id);
  const p = use.getPrev(s.id);
  const rank = [...services].sort((a, b) => use.get(b.id).connects - use.get(a.id).connects).findIndex((x) => x.id === s.id) + 1;
  const referrals = requests.filter((r) => r.referral?.partner === s.name);
  const verifiedAgo = daysSince(s.lastVerified);
  const contactedAgo = daysSince(s.lastContacted);

  /** Open a link and count it as a staff use of the service. */
  const reach = (kind: EventKind, url: string) => {
    trackServiceEvent(s.id, kind, 'staff');
    Linking.openURL(url).catch(() => setOpenError(`Couldn’t open ${url}`));
  };
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`;

  return (
    <Page contentStyle={{ maxWidth: 900 }}>
      <BackLink label="Services" href="/admin/services" />

      <View style={{ gap: space.sm }}>
        <View style={styles.badges}>
          <ServiceStatusBadge status={s.status} />
          <Badge label={s.category} fg={theme.textSecondary} bg={theme.fill} />
          {isStale(s) ? <Badge label={`Not verified in ${verifiedAgo} days`} icon="time" fg={theme.soon} bg={theme.warningSoft} /> : null}
        </View>
        <Txt variant="title" accessibilityRole="header">
          {s.name}
        </Txt>
        {s.description ? <Txt tone="secondary">{s.description}</Txt> : null}
      </View>

      <View style={styles.actions}>
        {s.phone ? <Button label={`Call ${s.phone}`} icon="call-outline" onPress={() => reach('call', `tel:${s.phone.replace(/[^\d+]/g, '')}`)} /> : null}
        {s.website ? <Button label="Website" icon="open-outline" variant="tinted" onPress={() => reach('link', s.website)} /> : null}
        {s.address ? <Button label="Directions" icon="navigate-outline" variant="tinted" onPress={() => reach('directions', mapsUrl)} /> : null}
        <Button
          label="Refer from a request"
          icon="git-network-outline"
          variant="tinted"
          onPress={() => router.navigate('/admin/requests')}
        />
      </View>
      {openError ? <Notice icon="information-circle-outline">{openError}</Notice> : null}

      <Group header="Details" headerIcon="information-circle-outline">
        {s.hours ? <Row title="Hours" detail={s.hours} /> : null}
        {s.address ? <Row title="Address" detail={s.address} /> : null}
        {s.eligibility ? <Row title="Who can use it" detail={s.eligibility} /> : null}
        {s.languages ? <Row title="Languages" detail={s.languages} /> : null}
      </Group>

      <Chips>
        {([7, 30, 90] as const).map((d) => (
          <Chip key={d} label={`Last ${d} days`} active={days === d} onPress={() => setDays(d)} />
        ))}
      </Chips>

      <View style={styles.kpis}>
        <Kpi>
          <StatTile label="Connections" value={String(c.connects)} delta={c.connects - p.connects} footnote={`#${rank} of ${services.length} services`} />
        </Kpi>
        <Kpi>
          <StatTile label="Detail views" value={String(c.view)} delta={c.view - p.view} />
        </Kpi>
        <Kpi>
          <StatTile label="Views that led to contact" value={`${Math.round(connectRate(c) * 100)}%`} />
        </Kpi>
        <Kpi>
          <StatTile label="Calls · website · directions" value={`${c.call} · ${c.link} · ${c.directions}`} />
        </Kpi>
        <Kpi>
          <StatTile label="Staff referrals" value={String(c.referral)} delta={c.referral - p.referral} />
        </Kpi>
      </View>

      <ChartCard
        title="Connections over time"
        subtitle={`${s.name}, ${trend.size === 7 ? 'by week' : 'by day'}.`}
        table={{ columns: [trend.size === 7 ? 'Week of' : 'Day', 'Connections'], rows: trend.labels.map((l, i) => [l, trend.values[i]]) }}
      >
        {c.connects ? (
          <LineChart labels={trend.labels} unit="connections" series={[{ name: 'Connections', color: chart.series[0], values: trend.values }]} />
        ) : (
          <Notice icon="alert-circle-outline">
            No one connected to this service in this period. Check that the listing is right, or whether residents need it.
          </Notice>
        )}
      </ChartCard>

      <Group header={`Referrals from requests (${referrals.length})`} headerIcon="git-network-outline" footer="Referrals sent from the request page show up here.">
        {referrals.length ? (
          referrals.map((r) => (
            <Row
              key={r.id}
              title={`${r.ref} · ${r.summary}`}
              subtitle={REFERRAL_LABEL[r.referral!.status]}
              accessory="chevron"
              onPress={() => router.navigate({ pathname: '/admin/requests/[id]', params: { id: r.id } })}
            />
          ))
        ) : (
          <Row title="No open referrals" subtitle="Refer residents from a request’s Referral section." />
        )}
      </Group>

      <Section title="Our relationship" icon="people-outline">
        <Picker
          label="Status"
          options={Object.keys(PARTNER_STATUS_LABEL)}
          labels={PARTNER_STATUS_LABEL}
          value={s.status}
          onChange={(v) => saveService({ ...s, status: v as PartnerStatus })}
        />
        <Group>
          <Row title="Contact" detail={s.contactName || 'Not set'} />
          {s.contactEmail ? <Row title="Email" detail={s.contactEmail} onPress={() => Linking.openURL(`mailto:${s.contactEmail}`)} accessory="chevron" /> : null}
          {s.contactPhone ? <Row title="Direct line" detail={s.contactPhone} /> : null}
          <Row
            title="Last contacted"
            detail={s.lastContacted ? `${s.lastContacted} (${contactedAgo}d ago)` : 'Never'}
            right={<Button label="Log today" variant="plain" onPress={() => saveService({ ...s, lastContacted: isoDay(0) })} />}
          />
          <Row
            title="Info last verified"
            detail={`${s.lastVerified} (${verifiedAgo}d ago)`}
            detailColor={isStale(s) ? theme.soon : undefined}
            right={<Button label="Verified today" variant="plain" onPress={() => saveService({ ...s, lastVerified: isoDay(0) })} />}
          />
        </Group>
        {isStale(s) ? (
          <Notice icon="time-outline" tone="warning">
            Over {STALE_DAYS} days since anyone confirmed the hours, phone, and eligibility. Call to check before sending more people.
          </Notice>
        ) : null}
        {s.notes ? <Txt tone="secondary">{s.notes}</Txt> : null}
      </Section>

      <View style={styles.actions}>
        <Button label="Edit service" icon="create-outline" variant="tinted" onPress={() => setEditing(true)} />
        <Button
          label={confirmDelete ? 'Tap again to remove' : 'Remove from directory'}
          icon="trash-outline"
          variant="destructive"
          onPress={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            removeService(s.id);
            router.navigate('/admin/services');
          }}
        />
      </View>
    </Page>
  );
}

function Kpi({ children }: { children: ReactNode }) {
  return <View style={styles.kpi}>{children}</View>;
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  kpi: { flexGrow: 1, flexBasis: 170, padding: space.xs },
});
