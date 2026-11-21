import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { ServiceForm } from '@/components/admin/ServiceForm';
import { ServiceStatusBadge } from '@/components/admin/serviceBits';
import { Badge } from '@/components/admin/requestBits';
import { RankedBars } from '@/components/charts/Bars';
import { ChartCard, StatTile } from '@/components/charts/ChartCard';
import { SegmentedBar } from '@/components/charts/Figures';
import { LineChart } from '@/components/charts/LineChart';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Button, Chip, Chips, EmptyState, Field, FieldLabel, Notice, Txt, success } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import {
  CONNECT_KINDS,
  EVENT_LABEL,
  SERVICE_CATEGORIES,
  STALE_DAYS,
  connectRate,
  emptyService,
  isStale,
  series,
  sumCounts,
  usage,
  type Counts,
  type Service,
} from '@/lib/services';
import { useChartTheme } from '@/theme/chart';
import { radius, space, useTheme } from '@/theme/tokens';

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;
type Sort = 'used' | 'least' | 'trend' | 'name' | 'verify';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'used', label: 'Most used' },
  { key: 'least', label: 'Least used' },
  { key: 'trend', label: 'Biggest change' },
  { key: 'name', label: 'Name' },
  { key: 'verify', label: 'Needs a check' },
];
const ALL = 'All';

/**
 * The services directory with usage: which services residents and staff
 * actually connect to, which go unused, and which listings need checking.
 */
export default function ServicesScreen() {
  const theme = useTheme();
  const chart = useChartTheme();
  const { width } = useWindowDimensions();
  const { services, serviceEvents, saveService } = useAdmin();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [category, setCategory] = useState<string>(ALL);
  const [sort, setSort] = useState<Sort>('used');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<Service | null>(null);

  const use = useMemo(() => usage(serviceEvents, days), [serviceEvents, days]);
  const trend = useMemo(() => series(serviceEvents, days), [serviceEvents, days]);

  if (adding) {
    return (
      <Page contentStyle={{ maxWidth: 820 }}>
        <SectionHeading title="Add a Service" kicker="Add it once here; staff can refer to it and residents will find it." />
        <ServiceForm
          initial={adding}
          isNew
          onCancel={() => setAdding(null)}
          onSave={(s) => {
            success();
            saveService(s);
            setAdding(null);
            router.navigate({ pathname: '/admin/services/[id]', params: { id: s.id } });
          }}
        />
      </Page>
    );
  }

  const totals = sumCounts(services.map((s) => use.get(s.id)));
  const prevTotals = sumCounts(services.map((s) => use.getPrev(s.id)));
  const unused = services.filter((s) => s.status !== 'inactive' && use.get(s.id).connects === 0);
  const stale = services.filter((s) => isStale(s));
  const ranked = [...services].map((s) => ({ s, c: use.get(s.id) })).sort((a, b) => b.c.connects - a.c.connects);

  const q = query.trim().toLowerCase();
  const shown = services
    .filter((s) => category === ALL || s.category === category)
    .filter((s) => !q || [s.name, s.category, s.description, s.address].join(' ').toLowerCase().includes(q))
    .sort((a, b) => {
      const ca = use.get(a.id).connects;
      const cb = use.get(b.id).connects;
      switch (sort) {
        case 'used':
          return cb - ca;
        case 'least':
          return ca - cb;
        case 'trend':
          return Math.abs(cb - use.getPrev(b.id).connects) - Math.abs(ca - use.getPrev(a.id).connects);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'verify':
          return a.lastVerified.localeCompare(b.lastVerified);
      }
    });
  const rangeLabel = RANGES.find((r) => r.days === days)!.label.toLowerCase();
  const twoUp = width >= 960;

  return (
    <Page contentStyle={{ maxWidth: 1100 }}>
      <BackLink label="Admin" href="/admin" />
      <SectionHeading title="Services" kicker="The services we connect residents to, and how much each one gets used." />

      <Notice icon="construct-outline" tone="warning">
        Resident clicks are sample data until the Resources page lists these services. Staff referrals and links opened here are recorded live.
      </Notice>

      <View style={styles.filters}>
        <View style={{ gap: 6 }}>
          <FieldLabel>Date range</FieldLabel>
          <Chips>
            {RANGES.map((r) => (
              <Chip key={r.days} label={r.label} active={days === r.days} onPress={() => setDays(r.days)} />
            ))}
          </Chips>
        </View>
      </View>

      <View style={styles.kpis}>
        <Kpi>
          <StatTile label="Connections" value={totals.connects.toLocaleString('en-US')} delta={totals.connects - prevTotals.connects} footnote="Calls, links, directions, referrals" />
        </Kpi>
        <Kpi>
          <StatTile label="Detail views" value={totals.view.toLocaleString('en-US')} delta={totals.view - prevTotals.view} />
        </Kpi>
        <Kpi>
          <StatTile
            label="Views that led to contact"
            value={`${Math.round(connectRate(totals) * 100)}%`}
            delta={Math.round((connectRate(totals) - connectRate(prevTotals)) * 100)}
            deltaUnit="pts"
          />
        </Kpi>
        <Kpi>
          <StatTile label="Unused services" value={String(unused.length)} footnote={unused.length ? unused.map((s) => s.name).join(', ') : 'Every service was used'} />
        </Kpi>
        <Kpi>
          <StatTile label="Listings to re-check" value={String(stale.length)} footnote={`Not verified in ${STALE_DAYS} days`} />
        </Kpi>
      </View>

      <Grid twoUp={twoUp}>
        <ChartCard
          title="Most connected services"
          subtitle={`Calls, website visits, directions, and referrals, ${rangeLabel}.`}
          table={{
            columns: ['Service', 'Views', 'Calls', 'Website', 'Directions', 'Referrals', 'Connections'],
            rows: ranked.map(({ s, c }) => [s.name, c.view, c.call, c.link, c.directions, c.referral, c.connects]),
          }}
        >
          <RankedBars items={ranked.slice(0, 8).map(({ s, c }) => ({ name: s.name, value: c.connects }))} color={chart.series[0]} unit="connections" />
        </ChartCard>

        <ChartCard
          title="Connections over time"
          subtitle={`All services, ${trend.size === 7 ? 'by week' : 'by day'}.`}
          table={{ columns: [trend.size === 7 ? 'Week of' : 'Day', 'Connections'], rows: trend.labels.map((l, i) => [l, trend.values[i]]) }}
        >
          <LineChart labels={trend.labels} unit="connections" series={[{ name: 'Connections', color: chart.series[0], values: trend.values }]} />
        </ChartCard>

        <ChartCard
          title="How people connect"
          subtitle={`What they did after finding a service, ${rangeLabel}.`}
          table={{ columns: ['Action', 'Count'], rows: CONNECT_KINDS.map((k) => [EVENT_LABEL[k], totals[k]]) }}
        >
          <SegmentedBar parts={CONNECT_KINDS.map((k) => ({ name: EVENT_LABEL[k], value: totals[k] }))} />
        </ChartCard>
      </Grid>

      <View style={styles.listHead}>
        <Text accessibilityRole="header" style={[styles.h2, { color: theme.text }]}>
          All services ({services.length})
        </Text>
        <Button label="Add a service" icon="add-circle-outline" onPress={() => setAdding(emptyService())} />
      </View>

      <Field icon="search" placeholder="Search services" value={query} onChangeText={setQuery} autoCapitalize="none" />
      <Chips scroll>
        {[ALL, ...SERVICE_CATEGORIES.filter((c) => services.some((s) => s.category === c))].map((c) => (
          <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </Chips>
      <View style={styles.sortRow}>
        <FieldLabel>Sort</FieldLabel>
        <Chips>
          {SORTS.map((s) => (
            <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />
          ))}
        </Chips>
      </View>

      {shown.length ? (
        <View style={{ gap: space.sm }}>
          {shown.map((s) => (
            <ServiceRow key={s.id} service={s} counts={use.get(s.id)} prev={use.getPrev(s.id)} />
          ))}
        </View>
      ) : (
        <EmptyState icon="business-outline" title="No services found" body="Try another search or category, or add the service." />
      )}
    </Page>
  );
}

function ServiceRow({ service: s, counts: c, prev }: { service: Service; counts: Counts; prev: Counts }) {
  const theme = useTheme();
  const change = c.connects - prev.connects;
  const pct = prev.connects ? Math.round((change / prev.connects) * 100) : null;
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: '/admin/services/[id]', params: { id: s.id } })}
      accessibilityRole="link"
      accessibilityLabel={`${s.name}, ${c.connects} connections`}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.badges}>
          <ServiceStatusBadge status={s.status} />
          {isStale(s) ? <Badge label="Re-check info" icon="time" fg={theme.soon} bg={theme.warningSoft} /> : null}
          {c.connects === 0 && s.status !== 'inactive' ? <Badge label="Unused" icon="alert-circle" fg={theme.textSecondary} bg={theme.fill} /> : null}
        </View>
        <Txt variant="headline">{s.name}</Txt>
        <Txt variant="footnote" tone="secondary" numberOfLines={1}>
          {[s.category, s.phone, s.hours].filter(Boolean).join(' · ')}
        </Txt>
      </View>
      <View style={styles.rowStats}>
        <Text style={[styles.rowValue, { color: theme.text }]}>{c.connects.toLocaleString('en-US')}</Text>
        <Text style={[styles.rowLabel, { color: theme.textTertiary }]}>connections</Text>
        {pct !== null && change !== 0 ? (
          <View style={styles.trend}>
            <Ionicons name={change > 0 ? 'arrow-up' : 'arrow-down'} size={12} color={theme.textSecondary} />
            <Text style={[styles.rowLabel, { color: theme.textSecondary }]}>{Math.abs(pct)}%</Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

function Kpi({ children }: { children: ReactNode }) {
  return <View style={styles.kpi}>{children}</View>;
}

function Grid({ twoUp, children }: { twoUp: boolean; children: ReactNode[] }) {
  if (!twoUp) return <View style={{ gap: space.lg }}>{children}</View>;
  return (
    <View style={styles.grid}>
      {children.map((c, i) => (
        <View key={i} style={[styles.cell, i === 0 && { width: '100%' }]}>
          {c}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.xs },
  kpi: { flexGrow: 1, flexBasis: 190, padding: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', margin: -space.sm },
  cell: { width: '50%', padding: space.sm },
  h2: { fontSize: 20, fontWeight: '800' },
  listHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginTop: space.md },
  sortRow: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rowStats: { alignItems: 'flex-end', minWidth: 80 },
  rowValue: { fontSize: 22, fontWeight: '700' },
  rowLabel: { fontSize: 12 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
